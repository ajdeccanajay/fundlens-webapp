"""Tests for the /calculate endpoint in api_server.py."""
import pytest
from httpx import AsyncClient, ASGITransport
from api_server import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.anyio
class TestCalculateEndpoint:
    async def test_basic_addition(self, client):
        resp = await client.post("/calculate", json={
            "formula": "a + b",
            "inputs": {"a": 10, "b": 20},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["result"] == 30
        assert data["audit_trail"]["formula"] == "a + b"
        assert data["audit_trail"]["inputs"] == {"a": 10, "b": 20}
        assert data["audit_trail"]["result"] == 30
        assert "execution_time_ms" in data["audit_trail"]

    async def test_gross_margin_formula(self, client):
        resp = await client.post("/calculate", json={
            "formula": "gross_profit / revenue * 100",
            "inputs": {"gross_profit": 50000000, "revenue": 120000000},
        })
        assert resp.status_code == 200
        assert abs(resp.json()["result"] - 41.6667) < 0.01

    async def test_complex_formula(self, client):
        resp = await client.post("/calculate", json={
            "formula": "(revenue - cost_of_revenue) / revenue * 100",
            "inputs": {"revenue": 100000, "cost_of_revenue": 60000},
        })
        assert resp.status_code == 200
        assert resp.json()["result"] == 40.0

    async def test_abs_function(self, client):
        resp = await client.post("/calculate", json={
            "formula": "abs(a - b)",
            "inputs": {"a": 5, "b": 10},
        })
        assert resp.status_code == 200
        assert resp.json()["result"] == 5

    async def test_round_function(self, client):
        resp = await client.post("/calculate", json={
            "formula": "round(a / b, 2)",
            "inputs": {"a": 10, "b": 3},
        })
        assert resp.status_code == 200
        assert resp.json()["result"] == 3.33

    async def test_min_max_functions(self, client):
        resp = await client.post("/calculate", json={
            "formula": "max(a, b) - min(a, b)",
            "inputs": {"a": 10, "b": 3},
        })
        assert resp.status_code == 200
        assert resp.json()["result"] == 7

    async def test_constant_formula(self, client):
        resp = await client.post("/calculate", json={
            "formula": "42",
            "inputs": {},
        })
        assert resp.status_code == 200
        assert resp.json()["result"] == 42

    async def test_negative_values(self, client):
        resp = await client.post("/calculate", json={
            "formula": "a + b",
            "inputs": {"a": -100, "b": 50},
        })
        assert resp.status_code == 200
        assert resp.json()["result"] == -50

    async def test_division_by_zero(self, client):
        resp = await client.post("/calculate", json={
            "formula": "a / b",
            "inputs": {"a": 10, "b": 0},
        })
        data = resp.json()
        assert data["error"] is not None
        assert "zero" in data["error"].lower()

    async def test_unknown_variable(self, client):
        resp = await client.post("/calculate", json={
            "formula": "a + unknown_var",
            "inputs": {"a": 10},
        })
        data = resp.json()
        assert data["error"] is not None

    async def test_empty_formula(self, client):
        resp = await client.post("/calculate", json={
            "formula": "",
            "inputs": {},
        })
        data = resp.json()
        assert data["error"] is not None

    async def test_audit_trail_structure(self, client):
        resp = await client.post("/calculate", json={
            "formula": "a * b",
            "inputs": {"a": 5, "b": 6},
        })
        trail = resp.json()["audit_trail"]
        assert trail["formula"] == "a * b"
        assert trail["inputs"] == {"a": 5, "b": 6}
        assert trail["result"] == 30
        assert isinstance(trail["execution_time_ms"], (int, float))
        assert len(trail["intermediate_steps"]) >= 3
