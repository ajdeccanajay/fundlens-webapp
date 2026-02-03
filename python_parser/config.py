"""
Configuration settings for SEC Parser API
"""
import os
from typing import List

class Settings:
    # API Settings
    API_TITLE: str = "SEC Parser API"
    API_VERSION: str = "1.0.0"
    API_DESCRIPTION: str = "API for parsing SEC filings using DOM and XBRL methods"
    
    # Server Settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # File Storage Settings
    SEC_FILINGS_PATH: str = os.getenv("SEC_FILINGS_PATH", "data")
    OUTPUT_PATH: str = os.getenv("OUTPUT_PATH", "output")
    
    # AWS S3 Settings (for production deployment)
    AWS_ACCESS_KEY_ID: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")
    S3_BUCKET: str = os.getenv("S3_BUCKET", "")
    USE_S3: bool = os.getenv("USE_S3", "False").lower() == "true"
    
    # Supported Filing Types
    SUPPORTED_FILING_TYPES: List[str] = ["10-K", "10-Q", "8-K"]
    
    # XBRL Settings
    XBRL_CACHE_TTL: int = int(os.getenv("XBRL_CACHE_TTL", "3600"))  # 1 hour
    XBRL_RATE_LIMIT: float = float(os.getenv("XBRL_RATE_LIMIT", "0.2"))  # seconds between requests
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

settings = Settings()
