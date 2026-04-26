"""Django app config for the jobs application."""

from django.apps import AppConfig


class JobsConfig(AppConfig):
    """Configuration for the ``jobs`` Django app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "jobs"
