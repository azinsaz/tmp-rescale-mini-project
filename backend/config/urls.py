"""URL configuration. The Ninja API instance is mounted at ``/api/``."""

from django.urls import path

from config.api import api

urlpatterns = [
    path("api/", api.urls),
]
