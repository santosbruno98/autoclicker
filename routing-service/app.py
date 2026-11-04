import asyncio
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Guarda VROOM + OSRM Routing")

VROOM_BIN: str = os.getenv(
    "VROOM_BIN",
    "/usr/local/bin/vroom",
)

OSRM_HOST: str = os.getenv(
    "OSRM_HOST",
    "127.0.0.1",
)

OSRM_PORT: str = os.getenv(
    "OSRM_PORT",
    "5000",
)

MAX_SNAP_DISTANCE_M: float = float(
    os.getenv("MAX_SNAP_DISTANCE_M", "250")
)

OSRM_REQUEST_TIMEOUT_S: float = 8.0
VROOM_TIMEOUT_S: float = 90.0
OSRM_RESPONSE_LIMIT: int = 1 << 20


def configured_coverage() -> tuple[float, float, float, float] | None:
    """
    Read optional bounds describing the deployed road graph.

    Format:
        west,south,east,north

    These bounds must match the deployed map. They are not inferred
    from an address, district name, or the user's current location.
    """
    raw: str = os.getenv("OSRM_COVERAGE_BBOX", "").strip()

    if not raw:
        return None

    try:
        values: list[float] = [
            float(value.strip())
            for value in raw.split(",")
        ]
    except ValueError as exc:
        raise ValueError(
            "OSRM_COVERAGE_BBOX must contain four numbers"
        ) from exc

    if len(values) != 4:
        raise ValueError(
            "OSRM_COVERAGE_BBOX must be west,south,east,north"
        )

    west, south, east, north = values

    if not (
        all(math.isfinite(value) for value in values)
        and -180 <= west < east <= 180
        and -90 <= south < north <= 90
    ):
        raise ValueError(
            "OSRM_COVERAGE_BBOX contains invalid bounds"
        )

    return west, south, east, north


if (
    not math.isfinite(MAX_SNAP_DISTANCE_M)
    or MAX_SNAP_DISTANCE_M <= 0
):
    raise ValueError(
        "MAX_SNAP_DISTANCE_M must be finite and greater than zero"
    )


COVERAGE_BBOX: tuple[float, float, float, float] | None = (
    configured_coverage()
)


class ValidateRequest(BaseModel):
    coordinates: list[tuple[float, float]] = Field(
        min_length=1,
        max_length=150,
    )


class OptimizeRequest(BaseModel):
    # Coordinate order: longitude, latitude.
    # The first point is always the starting location.
    coordinates: list[tuple[float, float]] = Field(
        min_length=2,
        max_length=150,
    )

    round_trip: bool = False


class PointIssue(BaseModel):
    input_index: int
    code: str
    message: str

    longitude: float
    latitude: float

    snap_distance_m: float | None = None


class RoadPoint(BaseModel):
    input_index: int

    # Original coordinates supplied by the caller.
    longitude: float
    latitude: float

    # Nearby road coordinates returned by OSRM.
    road_longitude: float
    road_latitude: float

    snap_distance_m: float


class ValidateResponse(BaseModel):
    points: list[RoadPoint]
    issues: list[PointIssue]


class OptimizeResponse(BaseModel):
    order: list[int]
    distance_m: float
    duration_s: float

    # Additional diagnostic data. Existing response fields remain.
    road_points: list[RoadPoint]


def valid_coordinate(
    longitude: float,
    latitude: float,
) -> bool:
    return (
        math.isfinite(longitude)
        and math.isfinite(latitude)
        and -180 <= longitude <= 180
        and -90 <= latitude <= 90
    )


def nearest_road_json(
    longitude: float,
    latitude: float,
) -> dict[str, Any]:
    """
    Query the deployed OSRM graph.

    A dependency/network failure is different from a valid response
    saying that no matching road exists.
    """
    endpoint: str = (
        f"http://{OSRM_HOST}:{OSRM_PORT}"
        "/nearest/v1/car/"
        f"{longitude:.8f},{latitude:.8f}"
        "?number=1"
    )

    try:
        with urlopen(
            endpoint,
            timeout=OSRM_REQUEST_TIMEOUT_S,
        ) as response:
            raw: bytes = response.read(
                OSRM_RESPONSE_LIMIT + 1
            )

    except HTTPError as exc:
        if exc.code in (400, 404):
            try:
                error_body: Any = json.loads(
                    exc.read(4096)
                )

                if (
                    isinstance(error_body, dict)
                    and error_body.get("code") == "NoSegment"
                ):
                    return error_body

            except (
                ValueError,
                UnicodeDecodeError,
            ):
                pass

        raise HTTPException(
            status_code=503,
            detail="OSRM road validation is unavailable",
        ) from exc

    except (
        URLError,
        TimeoutError,
        OSError,
    ) as exc:
        raise HTTPException(
            status_code=503,
            detail="OSRM road validation is unavailable",
        ) from exc

    if len(raw) > OSRM_RESPONSE_LIMIT:
        raise HTTPException(
            status_code=502,
            detail="OSRM road validation response is too large",
        )

    try:
        result: Any = json.loads(raw)

    except (
        ValueError,
        UnicodeDecodeError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail="OSRM returned invalid road validation JSON",
        ) from exc

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail="OSRM returned an invalid road validation structure",
        )

    return result


async def validate_one_point(
    index: int,
    longitude: float,
    latitude: float,
    semaphore: asyncio.Semaphore,
) -> RoadPoint | PointIssue:
    """
    Validate one original input point.

    The input index is preserved so the Go API can associate a
    failure with an address or with the starting location.
    """
    if not valid_coordinate(longitude, latitude):
        # Nonfinite coordinates cannot safely be included in JSON.
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_COORDINATES",
                "message": "Coordinates are invalid",
                "input_index": index,
            },
        )

    def issue(
        code: str,
        message: str,
        distance: float | None = None,
    ) -> PointIssue:
        return PointIssue(
            input_index=index,
            code=code,
            message=message,
            longitude=longitude,
            latitude=latitude,
            snap_distance_m=distance,
        )

    if COVERAGE_BBOX is not None:
        west, south, east, north = COVERAGE_BBOX

        if not (
            west <= longitude <= east
            and south <= latitude <= north
        ):
            return issue(
                "OUTSIDE_MAP_COVERAGE",
                "Location is outside the deployed road map",
            )

    async with semaphore:
        result: dict[str, Any] = await asyncio.to_thread(
            nearest_road_json,
            longitude,
            latitude,
        )

    if result.get("code") == "NoSegment":
        return issue(
            "ROAD_NOT_FOUND",
            "No road could be matched in the deployed map",
        )

    if result.get("code") != "Ok":
        raise HTTPException(
            status_code=502,
            detail="OSRM road validation failed",
        )

    try:
        waypoint: Any = result["waypoints"][0]
        location: Any = waypoint["location"]

        distance: float = float(
            waypoint["distance"]
        )

        road_longitude: float = float(
            location[0]
        )

        road_latitude: float = float(
            location[1]
        )

        if not (
            math.isfinite(distance)
            and distance >= 0
            and valid_coordinate(
                road_longitude,
                road_latitude,
            )
        ):
            raise ValueError("Invalid road waypoint")

    except (
        KeyError,
        IndexError,
        TypeError,
        ValueError,
        OverflowError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail="OSRM returned an invalid road waypoint",
        ) from exc

    if distance > MAX_SNAP_DISTANCE_M:
        return issue(
            "ROAD_TOO_FAR",
            (
                "Location is too far from a routable road; "
                "check the address or select its location"
            ),
            distance,
        )

    return RoadPoint(
        input_index=index,
        longitude=longitude,
        latitude=latitude,
        road_longitude=road_longitude,
        road_latitude=road_latitude,
        snap_distance_m=distance,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    # Process health only. /validate checks OSRM.
    return {"status": "ok"}


@app.post(
    "/validate",
    response_model=ValidateResponse,
)
async def validate_points(
    request: ValidateRequest,
) -> ValidateResponse:
    semaphore: asyncio.Semaphore = asyncio.Semaphore(6)

    results: list[RoadPoint | PointIssue] = list(
        await asyncio.gather(
            *(
                validate_one_point(
                    index,
                    longitude,
                    latitude,
                    semaphore,
                )
                for index, (
                    longitude,
                    latitude,
                ) in enumerate(request.coordinates)
            )
        )
    )

    return ValidateResponse(
        points=[
            item
            for item in results
            if isinstance(item, RoadPoint)
        ],
        issues=[
            item
            for item in results
            if isinstance(item, PointIssue)
        ],
    )


async def run_vroom(
    payload: dict[str, Any],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(
        prefix="vroom_"
    ) as directory:
        input_path: Path = (
            Path(directory) / "input.json"
        )

        input_path.write_text(
            json.dumps(
                payload,
                allow_nan=False,
            ),
            encoding="utf-8",
        )

        command: list[str] = [
            VROOM_BIN,
            "-i", str(input_path),
            "-r", "osrm",
            "-a", f"car:{OSRM_HOST}",
            "-p", f"car:{OSRM_PORT}",
            "-g",
            "-l", "30",
            "-t", "2",
        ]

        process: asyncio.subprocess.Process | None = None

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=VROOM_TIMEOUT_S,
            )

        except asyncio.TimeoutError as exc:
            if process is not None:
                if process.returncode is None:
                    process.kill()

                await process.communicate()

            raise HTTPException(
                status_code=504,
                detail="VROOM optimization timed out",
            ) from exc

        except asyncio.CancelledError:
            if process is not None:
                if process.returncode is None:
                    process.kill()

                await process.communicate()

            raise

        except OSError as exc:
            raise HTTPException(
                status_code=503,
                detail="VROOM executable unavailable",
            ) from exc

    if process.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail=(
                "VROOM execution failed: "
                + stderr.decode(
                    "utf-8",
                    errors="replace",
                )[:500]
            ),
        )

    try:
        result: Any = json.loads(stdout)

    except (
        json.JSONDecodeError,
        UnicodeDecodeError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail="VROOM returned invalid JSON",
        ) from exc

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail="VROOM returned an invalid response structure",
        )

    return result


@app.post(
    "/optimize",
    response_model=OptimizeResponse,
)
async def optimize(
    request: OptimizeRequest,
) -> OptimizeResponse:
    # Always validate all inputs, including the starting location.
    validation: ValidateResponse = await validate_points(
        ValidateRequest(
            coordinates=request.coordinates,
        )
    )

    if validation.issues:
        # Do not silently omit any supplied destination.
        raise HTTPException(
            status_code=422,
            detail={
                "code": "ROUTING_POINTS_REJECTED",
                "message": (
                    "Some locations need attention before routing"
                ),
                "issues": [
                    item.model_dump()
                    for item in validation.issues
                ],
            },
        )

    # Validation preserves input order. Original coordinates remain
    # available in road_points; VROOM receives nearby road matches.
    points: list[tuple[float, float]] = [
        (
            point.road_longitude,
            point.road_latitude,
        )
        for point in validation.points
    ]

    depot: list[float] = list(points[0])

    vehicle: dict[str, Any] = {
        "id": 1,
        "profile": "car",
        "start": depot,
    }

    if request.round_trip:
        vehicle["end"] = depot

    jobs: list[dict[str, Any]] = [
        {
            "id": index,
            "location": list(points[index]),
            "service": 0,
        }
        for index in range(1, len(points))
    ]

    result: dict[str, Any] = await run_vroom(
        {
            "vehicles": [vehicle],
            "jobs": jobs,
        }
    )

    if result.get("code") != 0:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "ROUTING_SOLUTION_REJECTED",
                "message": str(
                    result.get(
                        "error",
                        "Optimization failed",
                    )
                ),
            },
        )

    unassigned: Any = result.get("unassigned")

    if unassigned:
        issues: list[dict[str, Any]] = []

        if isinstance(unassigned, list):
            for item in unassigned:
                if not isinstance(item, dict):
                    continue

                index: Any = item.get("id")

                if (
                    type(index) is int
                    and 0 < index < len(request.coordinates)
                ):
                    longitude, latitude = (
                        request.coordinates[index]
                    )

                    issues.append(
                        PointIssue(
                            input_index=index,
                            code="DESTINATION_UNASSIGNED",
                            message=(
                                "This destination could not be "
                                "included in the optimized journey"
                            ),
                            longitude=longitude,
                            latitude=latitude,
                        ).model_dump()
                    )

        raise HTTPException(
            status_code=422,
            detail={
                "code": "ROUTING_POINTS_REJECTED",
                "message": (
                    "Some destinations could not be assigned"
                ),
                "issues": issues,
            },
        )

    routes: Any = result.get("routes")

    if (
        not isinstance(routes, list)
        or len(routes) != 1
        or not isinstance(routes[0], dict)
    ):
        raise HTTPException(
            status_code=502,
            detail="Expected one vehicle route",
        )

    route: dict[str, Any] = routes[0]
    steps: Any = route.get("steps")

    if not isinstance(steps, list):
        raise HTTPException(
            status_code=502,
            detail="Missing route steps",
        )

    order: list[int] = [0]

    for step in steps:
        if not isinstance(step, dict):
            raise HTTPException(
                status_code=502,
                detail="Invalid route step",
            )

        if step.get("type") == "job":
            job_id: Any = step.get("id")

            if type(job_id) is not int:
                raise HTTPException(
                    status_code=502,
                    detail="Invalid job ID in optimized route",
                )

            order.append(job_id)

    if (
        len(order) != len(points)
        or len(set(order)) != len(points)
        or order[0] != 0
        or set(order) != set(range(len(points)))
    ):
        raise HTTPException(
            status_code=502,
            detail="Invalid optimized stop order",
        )

    distance_raw: Any = route.get("distance")
    duration_raw: Any = route.get("duration")

    if (
        isinstance(distance_raw, bool)
        or isinstance(duration_raw, bool)
        or not isinstance(distance_raw, (int, float))
        or not isinstance(duration_raw, (int, float))
    ):
        raise HTTPException(
            status_code=502,
            detail="VROOM returned missing or nonnumeric route metrics",
        )

    distance: float = float(distance_raw)
    duration: float = float(duration_raw)

    if (
        not math.isfinite(distance)
        or not math.isfinite(duration)
        or distance < 0
        or duration < 0
    ):
        raise HTTPException(
            status_code=502,
            detail="VROOM returned nonfinite or negative route metrics",
        )

    return OptimizeResponse(
        order=order,
        distance_m=distance,
        duration_s=duration,
        road_points=validation.points,
    )