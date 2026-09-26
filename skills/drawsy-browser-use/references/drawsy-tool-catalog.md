# Drawsy Tool Catalog and Source-Grounded Boundaries

Read this reference only when the live UI hides a native tool, bucket-fill behavior is ambiguous, or an exact structured-canvas capability needs confirmation. It is a compact fallback reference; live UI state and callable tools win if the implementation changes.

## Surface and capability model

The agent-facing surface kinds are:

- `canvas`
- `presentation`
- `kanban`
- `jira`
- `neutral`

Canvas and presentation support live preview and canvas-oriented operations. The Companion protocol treats live preview as supported only for those two kinds. The Companion exposes access mode, internet status, model/skill/plugin metadata, and MCP-server metadata as session controls; use those as availability signals, not as permission to invent a missing tool.

The local Companion is a bridge that owns sessions, folder scope, previews, and local state, while the installed Codex or OpenCode runtime owns model execution. It does not grant broad desktop control. Native current-tab input depends on a connected Browser/Chrome capability; structured Drawsy MCP has a separate route.

## Native toolbar and More Tools

The current native catalog and shortcuts are:

| Tool | Shortcut | Use |
| --- | --- | --- |
| Hand | `H` | Pan the canvas |
| Selection | `V`, `1` | Select and manipulate existing elements |
| Rectangle | `R`, `2` | Rectangular object |
| Diamond | `D`, `3` | Diamond decision/object |
| Ellipse | `O`, `4` | Elliptical object |
| Arrow | `A`, `5` | Directed structured connector |
| Line | `L`, `6` | Undirected structured connector |
| Draw/Freedraw | `P`, `X`, `7` | Freehand/pencil-like stroke |
| Text | `T`, `8` | Editable text |
| Image | `9` | Insert an image |
| Eraser | `E`, `0` | Erase native marks |

The More Tools menu contains:

- Frame tool, `F`
- Web Embed, without a displayed letter shortcut
- Laser pointer, `K`
- Bucket fill, `B`
- Lasso when the full styles panel exposes it

These are native tools, not suggestions for faking the same result with generic objects. Re-read the live AX tree after opening More Tools because menu indices and visible items are dynamic.

## Bucket fill behavior

Bucket fill operates on visible boundaries and computes a closed polygon. The implementation can bridge small gaps, with a default scene-space gap tolerance of about 6, and can form holes. Fills do not become boundary owners.

Possible failure reasons include:

- `no_owner`
- `open_region`
- `too_complex`
- `too_small`
- `invalid_polygon`

Use it for an enclosed region after checking the boundary. If it fails, inspect the actual rendered boundary and make a targeted repair. A successful tool call still needs a rendered verification pass.

## Structured Drawsy MCP

The current canvas-scoped MCP surface includes:

- `read_current_canvas`: read the live attached canvas; it cannot read another canvas.
- `get_canvas_capabilities`: inspect supported native elements, connector routes, and presentation components when a design choice needs them.
- `apply_canvas_changes`: targeted element upserts and deletions, immediately visible; use progressive passes.
- `create_or_update_connector`: connect named source and target elements with native bindings; choose a straight, rounded, elbow, or automatic route when meaningful.
- `set_container_label`: create or update native bound text and use the editor's font measurements.
- `inspect_current_canvas_layout`: advisory checks for geometry, bindings, text fit, and rendered color contrast.
- `capture_canvas_context`: capture by element ids or bounds, with `maxDimension` from 256 through 4096; bounds and element ids are mutually exclusive.
- `attach_live_preview`: attach a local-only loopback preview with hot reload; it is not a saved/collaborative scene.
- `add_image_from_file`: add an actual PNG, JPEG, GIF, or WebP from an exact current-workspace path, or the supported `imagegen://latest` source.
- `replace_canvas_image_from_file`: replace an existing image while preserving its geometry, frame/order, bindings, and element identity.

Use `capture_canvas_context` for visual scale or annotations and a fresh screenshot for final rendered review. Do not treat layout bounds as proof of connector meaning.

## Draw Mode routing

The Companion's Draw Mode instruction is deliberately an intent router:

- Explicit freehand, pencil, sketch, hand-drawn, or human-like drawing goes through native current-tab Browser/Chrome pointer input.
- Shape, diagram, layout, connector, label, or other structured canvas changes go through Drawsy MCP.
- Mixed requests use both routes for their corresponding portions.
- If native Browser/Chrome is not available, report that freehand current-tab input is unavailable; never disguise structured objects as freehand.
- For a pure freehand request, make one compact native inspection pass, act, and verify the rendered canvas rather than repeatedly rediscovering it.

## Maintenance rule

This reference is not a runtime permission list and is not a substitute for live capability discovery. When maintaining Drawsy itself, inspect the current implementation and update only the affected behavior here; do not add a complete copied source catalog to the production skill.
