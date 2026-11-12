---
name: drawsy-fast-diagrams
description: Generate semantic Mermaid source and render it through Drawsy Fast Mode when a user requests a diagram on the attached canvas.
---

# Drawsy Fast Diagrams

For a new diagram, understand what the user wants to show, read the canvas and its capabilities (in parallel when available), submit one complete Mermaid source to `render_diagram_code`, then verify the result once. Use the first result that communicates the request clearly.

- Choose the diagram family and orientation from the user's intent and the canvas. Use `diagramCode.nativeEditableTypes` and `diagramCode.sourceMaxBytes` from `get_canvas_capabilities` for live support and limits. Preserve the user's facts and values. Consult [Mermaid syntax](https://mermaid.js.org/intro/syntax-reference.html) when needed. Drawsy's installed parser determines what works.
- Let the converter find clear space on the canvas. Set `presentationFrame` only when the diagram belongs on a slide. Submit the finished source directly; there is no need to stage test diagrams or compare orientations on the canvas.
- Review `outputKind`, `diagramType`, and the inserted IDs or bounds. For the rendered check, choose `inspect_current_canvas_layout` or a targeted `capture_canvas_context` based on what you need to verify. Check the new diagram for missing meaning, unreadable labels, or unclear relationships. An image fallback is an image.
- If conversion fails, make one focused retry when the error is actionable. If the rendered diagram has a material problem, make one focused replacement with a fresh `operationId` and set `replaceOperationId` to the successful render's operation ID. Then check the corrected result. Reuse an operation ID only for an unchanged retry. Keep a readable layout when changing direction or style would only be a preference. If the request still cannot be represented faithfully, report the limitation.
- Use the normal canvas tools for requested edits and cleanup of existing elements. Create new diagrams through the converter.
