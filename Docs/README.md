# Docs Folder Guide

This folder holds thesis material and system explainers:

- [how-renewal-and-recommendations-work.md](how-renewal-and-recommendations-work.md): thesis-ready, non-technical explanation of how return visits are predicted and packages are recommended, with test results.
- [renewal-model.md](renewal-model.md): plain-language guide to renewal predictions, training, test results, and metrics.
- [REVIEW_OF_RELATED_LITERATURE.md](REVIEW_OF_RELATED_LITERATURE.md) and [REVIEW_OF_RELATED_STUDIES.md](REVIEW_OF_RELATED_STUDIES.md): thesis literature chapters.
- [references.md](references.md): reference list.
- [diagrams/](diagrams/): Mermaid diagram sources (`.mmd`), described below.

Developer documentation (architecture, setup, generated code reference) lives
in [`Snaplytics/docs/`](../Snaplytics/docs/).

## Diagram Files

The `.mmd` files in [`diagrams/`](diagrams/) are thesis-ready diagram sources. They were updated on 2026-11-16 to match the current system: XGBoost and SVD++ inside the backend (there is no outside language-model service), Supabase PostgreSQL, the real database tables, and the current kiosk and staff screens.

| File | Shows |
|---|---|
| `diagrams/01-system-architecture.mmd` | Apps, backend services, models, database, email server |
| `diagrams/02-dfd-level-0-context.mmd` | The whole system and the three outside parties |
| `diagrams/03-dfd-level-1.mmd` | The eight main processes and six data stores |
| `diagrams/04-erd.mmd` | Database tables and how they link (from `Snaplytics/backend/models.py`) |
| `diagrams/05-staff-admin-owner-architecture.mmd` | What Staff, Admin, Owner and Dev mode may use |
| `diagrams/06-programming-design-tools.mmd` | Tools and libraries used to build the system |
| `diagrams/07-wireframe-flow.mmd` | Kiosk and staff app screen flow |

## Open and Render

Use either of these online editors:

- [https://www.mermaidonline.live/editor](https://www.mermaidonline.live/editor)
- [https://mermaid.live/](https://mermaid.live/)

## Copy-Paste Workflow

1. Open any `.mmd` file in the `Docs/diagrams` folder.
2. Copy the full file content.
3. Open one of the editors listed above.
4. Clear the default sample text.
5. Paste your copied content.
6. Wait for the preview to render.

## Export Workflow

1. Click the editor export/download button.
2. Export as `PNG` for thesis manuscript insertion.
3. Export as `SVG` for high-quality presentation slides.

## Notes

- Files include a unified theme for consistent visual styling.
- If rendering fails, re-copy the entire file and paste again.
- Keep node labels concise to prevent overlap.
