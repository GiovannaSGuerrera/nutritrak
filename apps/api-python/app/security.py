import hashlib, secrets
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
def hash_password(password: str) -> str: return hasher.hash(password)
def verify_password(encoded: str, password: str) -> bool:
    try: return hasher.verify(encoded, password)
    except (VerifyMismatchError, VerificationError): return False
def new_session_id() -> str: return secrets.token_urlsafe(32)
def digest_token(token: str) -> str: return hashlib.sha256(token.encode()).hexdigest()
def utcnow(): return datetime.now(timezone.utc)
def session_expiry(): return utcnow() + timedelta(hours=int(__import__('os').getenv('SESSION_TTL_HOURS', '8')))
