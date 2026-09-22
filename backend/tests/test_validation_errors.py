"""Request validation responses must not echo credentials or other inputs."""

import httpx
import pytest

from backend.app.main import app


@pytest.mark.asyncio
async def test_invalid_3cx_setup_does_not_echo_client_secret_in_422_response():
    client_secret = "test-only-3cx-secret-must-not-appear-in-response"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.put(
            "/integrations/3cx",
            json={
                "connection_name": "test",
                "pbx_url": "https://pbx.example.invalid",
                "app_id": "service-principal-client-id",
                "route_point_dn": "8000",
                "client_secret": client_secret,
                "dids": "not-a-list",
                "transfer_destinations": [],
            },
        )

    assert response.status_code == 422
    assert client_secret not in response.text
    assert '"input"' not in response.text
