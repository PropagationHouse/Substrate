"""
Generate a self-signed TLS certificate for the Substrate WebUI.

Usage:
  python certs/generate_cert.py                    # uses defaults
  python certs/generate_cert.py --force             # regenerate even if certs exist
  python certs/generate_cert.py --ip 10.147.17.34   # add extra IP to SAN

Produces:  certs/server.crt  +  certs/server.key
"""
import os, sys, argparse

CERT_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(CERT_DIR, "server.key")
CERT_FILE = os.path.join(CERT_DIR, "server.crt")

parser = argparse.ArgumentParser()
parser.add_argument('--force', action='store_true', help='Regenerate even if certs exist')
parser.add_argument('--ip', action='append', default=[], help='Extra IP addresses for SAN')
args = parser.parse_args()

if not args.force and os.path.exists(KEY_FILE) and os.path.exists(CERT_FILE):
    print(f"Certs already exist:\n  {CERT_FILE}\n  {KEY_FILE}")
    print("Use --force to regenerate.")
    sys.exit(0)

# Build SAN IP list: always include localhost + loopback, plus any extras
SAN_IPS = ["127.0.0.1", "10.147.17.34"] + args.ip

try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime, ipaddress

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Substrate-Agent"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Substrate"),
    ])

    # Build SAN entries — only individual IPs, no CIDR ranges
    san_entries = [x509.DNSName("localhost")]
    seen = set()
    for ip_str in SAN_IPS:
        ip_str = ip_str.strip()
        if ip_str in seen:
            continue
        seen.add(ip_str)
        san_entries.append(x509.IPAddress(ipaddress.IPv4Address(ip_str)))

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .sign(key, hashes.SHA256())
    )

    with open(KEY_FILE, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))

    with open(CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    san_list = ", ".join(str(s.value) for s in san_entries)
    print(f"Certificate generated:\n  {CERT_FILE}\n  {KEY_FILE}\n  SAN: {san_list}")

except ImportError:
    print("ERROR: 'cryptography' package not available.")
    print("Install with:  pip install cryptography")
    sys.exit(1)
