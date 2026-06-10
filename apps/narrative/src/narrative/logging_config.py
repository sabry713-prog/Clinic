from __future__ import annotations

import logging
import structlog


def configure_logging(service: str) -> None:
    """Configure structlog for structured JSON logging (PHI-free)."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )

    # Inject service name into every log record
    structlog.contextvars.bind_contextvars(service=service)
