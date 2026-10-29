
import asyncio
import hmac
import json
import math
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Guarda VROOM + OSRM Routing")

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
        f"Bearer {API_KEY}"
    ):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized"
        )

    points = request.coordinates

    for longitude, latitude in points:
        if not (
            math.isfinite(longitude)
            and math.isfinite(latitude)
            and -180 <= longitude <= 180
            and -90 <= latitude <= 90
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid coordinates"
            )

    depot = list(points[0])

    vehicle = {
        "id": 1,
        "profile": "car",
        "start": depot
    }

    if request.round_trip:
        vehicle["end"] = depot

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

    with tempfile.TemporaryDirectory(prefix="vroom_") as directory:
        input_path = Path(directory) / "input.json"
        input_path.write_text(
            json.dumps(payload),
            encoding="utf-8"
        )

        command = [
            VROOM_BIN,
            "-i", str(input_path),
            "-r", "osrm",
            "-a", f"car:{OSRM_HOST}",
            "-p", f"car:{OSRM_PORT}",
            "-l", "30",
            "-t", "2"
        ]

        process = None

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=90
            )

        except asyncio.TimeoutError:
            if process is not None:
                process.kill()
                await process.communicate()

            raise HTTPException(
                status_code=504,
                detail="VROOM optimization timed out"
            )

        except OSError as exc:
            raise HTTPException(
                status_code=503,
                detail="VROOM executable unavailable"
            ) from exc

    if process.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail=(
                "VROOM execution failed: " +
                stderr.decode("utf-8", errors="replace")[:500]
            )
        )

    try:
        result = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="VROOM returned invalid JSON"
        ) from exc

    if result.get("code") != 0:
        raise HTTPException(
            status_code=422,
            detail=str(
                result.get("error", "Optimization failed")
            )
        )

    if result.get("unassigned"):
        raise HTTPException(
            status_code=422,
            detail="Some destinations could not be assigned"
        )

    routes = result.get("routes", [])

    if len(routes) != 1:
        raise HTTPException(
            status_code=502,
            detail="Expected one vehicle route"
        )

    route = routes[0]

    order = [0]

    for step in route.get("steps", []):
        if step.get("type") == "job":
            order.append(int(step["id"]))

    if (
        len(order) != len(points)
        or len(set(order)) != len(points)
        or order[0] != 0
        or set(order) != set(range(len(points)))
    ):
        raise HTTPException(
            status_code=502,
            detail="Invalid optimized stop order"
        )

    distance = route.get("distance")
    duration = route.get("duration")

    if distance is None or duration is None:
        raise HTTPException(
            status_code=502,
            detail="Missing distance or duration"
        )

    distance = float(distance)
    duration = float(duration)

    if (
        not math.isfinite(distance)
        or not math.isfinite(duration)
        or distance < 0
        or duration < 0
    ):
        raise HTTPException(
            status_code=502,
            detail="Invalid route metrics"
        )

    return {
        "order": order,
        "distance_m": distance,
        "duration_s": duration
    }
