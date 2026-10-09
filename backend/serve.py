"""Dual-stack (IPv4 + IPv6) HTTP Server Launcher for Fly.io and Production Deployments.

Ensures both Fly.io 6PN internal IPv6 mesh traffic and Fly internal IPv4 health checks succeed.
"""

import socket
import sys
import uvicorn


def run_dual_stack(app_import: str, port: int = 8000) -> None:
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        # Disable IPV6_V6ONLY so the socket accepts both IPv6 and mapped IPv4
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    except (AttributeError, OSError):
        pass
    sock.bind(("::", port))
    sock.listen(256)

    config = uvicorn.Config(
        app_import,
        log_level="info",
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    app_target = sys.argv[1] if len(sys.argv) > 1 else "backend.app.main:app"
    port_num = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    run_dual_stack(app_target, port_num)

