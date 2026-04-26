"""Unit tests for ``config.logging.build_log_config``.

Tests the dict structure (formatters, handlers, levels) for each env profile.
End-to-end logging behaviour is exercised in T4.x.
"""

from __future__ import annotations

import logging.config

from config.logging import build_log_config


def _set_env(monkeypatch, **env):
    """Helper: clear and set the locked env vars for a clean per-test state."""
    for key in ("JOBS_ENV", "JOBS_LOG_FORMAT", "JOBS_LOG_LEVEL", "LOG_DIR", "SERVICE_NAME"):
        monkeypatch.delenv(key, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)


def test_dev_text_profile(monkeypatch, tmp_path):
    _set_env(
        monkeypatch,
        JOBS_ENV="dev",
        JOBS_LOG_FORMAT="text",
        LOG_DIR=str(tmp_path),
        SERVICE_NAME="api",
    )
    cfg = build_log_config()

    assert cfg["handlers"]["console"]["formatter"] == "text_color"
    assert cfg["handlers"]["file"]["formatter"] == "text_plain"
    assert cfg["handlers"]["file"]["class"] == "logging.handlers.RotatingFileHandler"
    assert cfg["handlers"]["file"]["maxBytes"] == 10 * 1024 * 1024
    assert cfg["handlers"]["file"]["backupCount"] == 7
    fname = cfg["handlers"]["file"]["filename"]
    assert fname.endswith(".log")
    assert "dev-api-" in fname


def test_prod_json_profile(monkeypatch, tmp_path):
    _set_env(
        monkeypatch,
        JOBS_ENV="prod",
        JOBS_LOG_FORMAT="json",
        LOG_DIR=str(tmp_path),
        SERVICE_NAME="api",
    )
    cfg = build_log_config()

    assert cfg["handlers"]["console"]["formatter"] == "json"
    assert cfg["handlers"]["file"]["formatter"] == "json"
    fname = cfg["handlers"]["file"]["filename"]
    assert fname.endswith(".json")
    assert "prod-api-" in fname


def test_prod_defaults_to_json_when_log_format_unset(monkeypatch, tmp_path):
    _set_env(monkeypatch, JOBS_ENV="prod", LOG_DIR=str(tmp_path))
    cfg = build_log_config()
    assert cfg["handlers"]["console"]["formatter"] == "json"


def test_dev_defaults_to_text_when_log_format_unset(monkeypatch, tmp_path):
    _set_env(monkeypatch, JOBS_ENV="dev", LOG_DIR=str(tmp_path))
    cfg = build_log_config()
    assert cfg["handlers"]["console"]["formatter"] == "text_color"


def test_creates_log_dir_if_missing(monkeypatch, tmp_path):
    nested = tmp_path / "a" / "b" / "c"
    _set_env(monkeypatch, JOBS_ENV="dev", LOG_DIR=str(nested))
    build_log_config()
    assert nested.is_dir()


def test_dictconfig_applies_without_error(monkeypatch, tmp_path):
    """The factory's output must be accepted by stdlib dictConfig.

    Catches typos in '()' factory paths, missing formatter refs, etc.
    """
    _set_env(monkeypatch, JOBS_ENV="dev", JOBS_LOG_FORMAT="text", LOG_DIR=str(tmp_path))
    cfg = build_log_config()
    logging.config.dictConfig(cfg)


def test_dictconfig_applies_for_json_profile(monkeypatch, tmp_path):
    _set_env(monkeypatch, JOBS_ENV="prod", JOBS_LOG_FORMAT="json", LOG_DIR=str(tmp_path))
    cfg = build_log_config()
    logging.config.dictConfig(cfg)


def test_default_level_is_info(monkeypatch, tmp_path):
    _set_env(monkeypatch, JOBS_ENV="dev", LOG_DIR=str(tmp_path))
    cfg = build_log_config()
    assert cfg["loggers"][""]["level"] == "INFO"
    assert cfg["handlers"]["console"]["level"] == "INFO"


def test_log_level_env_var_overrides(monkeypatch, tmp_path):
    _set_env(monkeypatch, JOBS_ENV="dev", LOG_DIR=str(tmp_path), JOBS_LOG_LEVEL="DEBUG")
    cfg = build_log_config()
    assert cfg["loggers"][""]["level"] == "DEBUG"


# ---- JSON output integration (T4.3) ----------------------------------------


def test_json_format_writes_valid_single_line_records(monkeypatch, tmp_path):
    """End-to-end: with JOBS_LOG_FORMAT=json, file output contains parseable JSON
    with the locked keys (timestamp, level, logger, service, env, message)
    plus any structured `extra`."""
    import json
    import logging
    import logging.config

    _set_env(
        monkeypatch,
        JOBS_ENV="prod",
        JOBS_LOG_FORMAT="json",
        LOG_DIR=str(tmp_path),
        SERVICE_NAME="test-api",
    )
    cfg = build_log_config()
    logging.config.dictConfig(cfg)

    logger = logging.getLogger("jobs.t4_3")
    logger.info("event_under_test", extra={"job_id": 99})

    # Find the .json file the factory created
    json_files = list(tmp_path.glob("prod-test-api-*.json"))
    assert json_files, f"no prod-test-api-*.json in {tmp_path}: {list(tmp_path.iterdir())}"

    content = json_files[0].read_text().strip()
    assert content, "json log file is empty"
    last_line = content.splitlines()[-1]
    record = json.loads(last_line)  # raises if not valid JSON

    assert record["level"] == "INFO"
    assert record["logger"] == "jobs.t4_3"
    assert record["service"] == "test-api"
    assert record["env"] == "prod"
    assert record["message"] == "event_under_test"
    assert record["job_id"] == 99
    assert "timestamp" in record
