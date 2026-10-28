
import os
import hmac
import math
import httpx

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

app = FastAPI(title="MyPlatform Routing Service")

OSRM_URL = os.getenv("OSRM_URL", "http://127.0.0.1:5000")
API_KEY = os.getenv("ROUTING_API_KEY", "")


class OptimizeRequest(BaseModel):
    coordinates: list[tuple[float, float]] = Field(
        min_length=2, max_length=150
    )
    round_trip: bool = False


def check_coordinates(coordinates):
    for lon, lat in coordinates:
        if not (
            math.isfinite(lon)
            and math.isfinite(lat)
            and -180 <= lon <= 180
            and -90 <= lat <= 90
        ):
            raise HTTPException(400, "Invalid coordinates")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/optimize")
async def optimize(
    payload: OptimizeRequest,
    authorization: str = Header(default="")
):
    expected = "Bearer " + API_KEY
    if not API_KEY or not hmac.compare_digest(
        authorization, expected
    ):
        raise HTTPException(401, "Unauthorized")

    points = payload.coordinates
    check_coordinates(points)

    coords = ";".join(
        f"{lon:.6f},{lat:.6f}" for lon, lat in points
    )

    url = f"{OSRM_URL}/table/v1/driving/{coords}"

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            response = await client.get(
                url,
                params={"annotations": "duration,distance"}
            )
            response.raise_for_status()
            matrix = response.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                502, "OSRM matrix request failed"
            ) from exc

    if matrix.get("code") != "Ok":
        raise HTTPException(
            422, "OSRM could not calculate all road connections"
        )

    durations = matrix["durations"]
    distances = matrix["distances"]
    n = len(points)

    if any(
        value is None
        for row in durations
        for value in row
    ):
        raise HTTPException(
            422, "Some locations are unreachable by road"
        )

    # The depot is node 0. For an open route, create a
    # virtual end node with zero-cost incoming arcs.
    size = n if payload.round_trip else n + 1
    virtual_end = None if payload.round_trip else n

    manager = pywrapcp.RoutingIndexManager(
        size,
        1,
        [0],
        [0 if payload.round_trip else virtual_end]
    )

    routing = pywrapcp.RoutingModel(manager)

    def time_callback(from_index, to_index):
        a = manager.IndexToNode(from_index)
        b = manager.IndexToNode(to_index)

        if a == virtual_end or b == virtual_end:
            return 0

        return int(round(durations[a][b] * 1000))

    transit_index = routing.RegisterTransitCallback(
        time_callback
    )
    routing.SetArcCostEvaluatorOfAllVehicles(transit_index)

    search = pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy
        .PATH_CHEAPEST_ARC
    )
    search.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic
        .GUIDED_LOCAL_SEARCH
    )
    search.time_limit.seconds = 15

    solution = routing.SolveWithParameters(search)

    if solution is None:
        raise HTTPException(422, "No feasible route found")

    order = []
    index = routing.Start(0)

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != virtual_end:
            order.append(node)
        index = solution.Value(routing.NextVar(index))

    if len(order) != n or len(set(order)) != n:
        raise HTTPException(500, "Invalid optimization result")

    journey = order[:]
    if payload.round_trip:
        journey.append(0)

    total_distance = 0.0
    total_duration = 0.0

    for a, b in zip(journey, journey[1:]):
        total_distance += distances[a][b]
        total_duration += durations[a][b]

    return {
        "order": order,
        "distance_m": total_distance,
        "duration_s": total_duration
    }
