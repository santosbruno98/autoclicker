
import asyncio
import hmac
import json
import math
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Guarda Routing Service")

API_KEY = os.getenv("ROUTING_API_KEY", "")
VROOM_BIN = os.getenv("VROOM_BIN", "/usr/local/bin/vroom")
OSRM_HOST = os.getenv("OSRM_HOST", "127.0.0.1")
OSRM_PORT = os.getenv("OSRM_PORT", "5000")


class OptimizeRequest(BaseModel):
    coordinates: list[tuple[float, float]] = Field(
        min_length=2,
        max_length=150
    )
    round_trip: bool = False


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/optimize")
async def optimize(
    request: OptimizeRequest,
    authorization: str = Header(default="")
):
    if not API_KEY or not hmac.compare_digest(
        authorization,
        "Bearer " + API_KEY
    ):
        raise HTTPException(401, "Unauthorized")

    points = request.coordinates

    for lon, lat in points:
        if not (
            math.isfinite(lon)
            and math.isfinite(lat)
            and -180 <= lon <= 180
            and -90 <= lat <= 90
        ):
            raise HTTPException(400, "Invalid coordinates")

    # Index 0 is the depot. All remaining coordinates
    # are delivery/collection destinations.
    vehicle = {
        "id": 1,
        "profile": "car",
        "start": list(points[0])
    }

    if request.round_trip:
        vehicle["end"] = list(points[0])

    jobs = [
        {
            "id": index,
            "location": list(points[index]),
            "service": 0
        }
        for index in range(1, len(points))
    ]

    payload = {
        "vehicles": [vehicle],
        "jobs": jobs
    }

    command = [
        VROOM_BIN,
        "-r", "osrm",
        "-a", f"car:{OSRM_HOST}",
        "-p", f"car:{OSRM_PORT}",
        "-g",
        "-l", "30",
        "-t", "2",
        "-x", "3"
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await asyncio.wait_for(
            process.communicate(
                json.dumps(payload).encode("utf-8")
            ),
            timeout=60
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise HTTPException(504, "VROOM timed out")
    except OSError:
        raise HTTPException(503, "VROOM executable unavailable")

    if process.returncode != 0:
        raise HTTPException(
            502,
            f"VROOM execution failed: {stderr.decode()[:300]}"
        )

    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        raise HTTPException(502, "Invalid VROOM response")

    if result.get("code") != 0:
        raise HTTPException(
            422,
            result.get("error", "Route optimization failed")
        )

    if result.get("unassigned"):
        raise HTTPException(
            422,
            "Some destinations are unreachable or unassigned"
        )

    routes = result.get("routes", [])
    if len(routes) != 1:
        raise HTTPException(502, "Expected exactly one vehicle route")

    route = routes[0]

    order = [0]
    for step in route.get("steps", []):
        if step.get("type") == "job":
            order.append(step["id"])

    if (
        len(order) != len(points)
        or len(set(order)) != len(points)
        or order[0] != 0
    ):
        raise HTTPException(502, "Invalid optimized stop order")

    distance = route.get("distance")
    duration = route.get("duration")

    if distance is None or duration is None:
        raise HTTPException(
            502,
            "VROOM did not return distance or duration"
        )

    return {
        "order": order,
        "distance_m": float(distance),
        "duration_s": float(duration)
    }
