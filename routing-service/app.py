import asyncio
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Guarda VROOM + OSRM Routing")

VROOM_BIN: str = os.getenv("VROOM_BIN", "/usr/local/bin/vroom")
OSRM_HOST: str = os.getenv("OSRM_HOST", "127.0.0.1")
OSRM_PORT: str = os.getenv("OSRM_PORT", "5000")


class OptimizeRequest(BaseModel):
    # Coordinate order: longitude, latitude.
    # First coordinate is the starting location.
    coordinates: list[tuple[float, float]] = Field(
        min_length=2,
        max_length=150,
    )
    round_trip: bool = False


class OptimizeResponse(BaseModel):
    order: list[int]
    distance_m: float
    duration_s: float


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/optimize", response_model=OptimizeResponse)
async def optimize(request: OptimizeRequest) -> OptimizeResponse:
    points: list[tuple[float, float]] = request.coordinates

    for longitude, latitude in points:
        if not (
            math.isfinite(longitude)
            and math.isfinite(latitude)
            and -180 <= longitude <= 180
            and -90 <= latitude <= 90
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid coordinates",
            )

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

    payload: dict[str, Any] = {
        "vehicles": [vehicle],
        "jobs": jobs,
    }

    with tempfile.TemporaryDirectory(prefix="vroom_") as directory:
        input_path: Path = Path(directory) / "input.json"
        input_path.write_text(
            json.dumps(payload, allow_nan=False),
            encoding="utf-8",
        )

        command: list[str] = [
            VROOM_BIN,
            "-i", str(input_path),
            "-r", "osrm",
            "-a", f"car:{OSRM_HOST}",
            "-p", f"car:{OSRM_PORT}",
            "-g",  # Required for route distance and geometry.
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
                timeout=90,
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
                + stderr.decode("utf-8", errors="replace")[:500]
            ),
        )

    try:
        result: Any = json.loads(stdout)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="VROOM returned invalid JSON",
        ) from exc

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail="VROOM returned an invalid response structure",
        )

    if result.get("code") != 0:
        raise HTTPException(
            status_code=422,
            detail=str(result.get("error", "Optimization failed")),
        )

    if result.get("unassigned"):
        raise HTTPException(
            status_code=422,
            detail="Some destinations could not be assigned",
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

    if distance_raw is None:
        raise HTTPException(
            status_code=502,
            detail="VROOM response is missing route.distance; check the -g flag",
        )

    if duration_raw is None:
        raise HTTPException(
            status_code=502,
            detail="VROOM response is missing route.duration",
        )

    if (
        isinstance(distance_raw, bool)
        or isinstance(duration_raw, bool)
        or not isinstance(distance_raw, (int, float))
        or not isinstance(duration_raw, (int, float))
    ):
        raise HTTPException(
            status_code=502,
            detail="VROOM returned nonnumeric route metrics",
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
    )