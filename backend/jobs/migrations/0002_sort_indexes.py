"""Add composite indexes for sortable cursor pagination on GET /api/jobs/.

The ``-updated_at, -id`` and ``name, id`` indexes back the new ``sort``
query parameter (see ``jobs.pagination.SortableCursorPagination``). Names
are kept ≤30 chars to stay under Django's E034 cap.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("jobs", "0001_initial"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="job",
            index=models.Index(
                fields=["-updated_at", "-id"], name="idx_job_updated_id_desc"
            ),
        ),
        migrations.AddIndex(
            model_name="job",
            index=models.Index(
                fields=["name", "id"], name="idx_job_name_id_asc"
            ),
        ),
    ]
