"""Read-only public endpoint probes; never override DNS or weaken verified TLS."""

import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
from urllib.parse import urlsplit


def http_summary(response):
    """Keep protocol evidence without logging redirect tokens or cookies."""
    lines = response.decode("ascii", errors="replace").splitlines()
    summary = lines[:1]
    for line in lines[1:]:
        if line.lower().startswith("location:"):
            target = urlsplit(line.split(":", 1)[1].strip())
            summary.append(f"Location: {target.scheme}://{target.netloc}{target.path}")
        elif line.lower().startswith("server:"):
            summary.append(line)
    return summary


def command(args, timeout=35):
    print("+", " ".join(args), flush=True)
    try:
        result = subprocess.run(
            args, stdin=subprocess.DEVNULL, timeout=timeout, check=False)
        print("exit:", result.returncode, flush=True)
        return result.returncode
    except (OSError, subprocess.TimeoutExpired) as error:
        print(type(error).__name__, str(error), flush=True)
        return 1


def main():
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                 "http_proxy", "https_proxy", "all_proxy"):
        print(f"{name}: {'configured' if os.getenv(name) else 'unset'}", flush=True)
    print(Path("/etc/resolv.conf").read_text(), flush=True)
    command(["curl", "--version"])
    failed = False
    endpoints = (
        ("fulcio.sigstore.dev", "/api/v1/rootCert"),
        ("rekor.sigstore.dev", "/api/v1/log/publicKey"),
    )
    for host, path in endpoints:
        print(f"=== {host} ===", flush=True)
        try:
            print("system getaddrinfo:", sorted({
                address[4][0] for address in socket.getaddrinfo(
                    host, 443, type=socket.SOCK_STREAM)
            }), flush=True)
        except OSError as error:
            print("DNS error:", error, flush=True)
        for line in Path("/etc/hosts").read_text().splitlines():
            if host in line:
                print("hosts override:", line, flush=True)
        # DNS-over-HTTPS is comparison evidence only, never a routing override.
        for record in ("A", "AAAA"):
            command(["curl", "--fail", "--silent", "--show-error",
                     "--connect-timeout", "10", "--max-time", "20",
                     f"https://dns.google/resolve?name={host}&type={record}"])
        for family in ([], ["--ipv4"], ["--ipv6"]):
            rc = command(["curl", *family, "--fail", "--silent", "--show-error",
                          "--connect-timeout", "10", "--max-time", "20",
                          "--output", "/dev/null", "--write-out",
                          "remote_ip=%{remote_ip} http_code=%{http_code} "
                          "ssl_verify_result=%{ssl_verify_result}\n",
                          f"https://{host}{path}"])
            if not family and rc:
                failed = True
        for version in ("1.2", "1.3"):
            command(["curl", "--tlsv" + version, "--tls-max", version,
                     "--fail", "--silent", "--show-error",
                     "--connect-timeout", "10", "--max-time", "20",
                     "--output", "/dev/null", "--write-out",
                     "remote_ip=%{remote_ip} http_code=%{http_code} "
                     "ssl_verify_result=%{ssl_verify_result}\n",
                     f"https://{host}{path}"])
        command(["timeout", "20", "openssl", "s_client",
                 "-connect", f"{host}:443", "-servername", host,
                 "-verify_hostname", host, "-verify_return_error",
                 "-brief", "-state"], timeout=25)
        # A public, credential-free HEAD can reveal an HTTP rejection/redirect.
        # Do not follow redirects or use this transport for release operations.
        for port in (80, 443):
            try:
                with socket.create_connection((host, port), timeout=10) as stream:
                    stream.sendall(
                        f"HEAD / HTTP/1.1\r\nHost: {host}\r\n"
                        "Connection: close\r\n\r\n".encode("ascii"))
                    print(f"HTTP HEAD port {port} response:",
                          http_summary(stream.recv(1024)), flush=True)
            except OSError as error:
                print(f"HTTP HEAD port {port}:", error, flush=True)
        # Capture only a TLS record header / short plaintext rejection from
        # the normal route. No application data, credentials, or HTTP request.
        context = ssl.create_default_context()
        outgoing, incoming = ssl.MemoryBIO(), ssl.MemoryBIO()
        connection = context.wrap_bio(incoming, outgoing, server_hostname=host)
        try:
            connection.do_handshake()
        except ssl.SSLWantReadError:
            pass
        try:
            with socket.create_connection((host, 443), timeout=10) as stream:
                stream.sendall(outgoing.read())
                response = stream.recv(256)
                print("TLS ClientHello response:",
                      f"bytes={len(response)} prefix={response[:32].hex()} "
                      f"all_ff={bool(response) and set(response) == {255}}",
                      flush=True)
        except OSError as error:
            print("TLS prefix probe:", error, flush=True)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
