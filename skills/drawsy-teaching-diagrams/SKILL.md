---
name: drawsy-teaching-diagrams
description: Create and refine teacher-ready explanatory diagrams on a live Drawsy canvas by combining intentional freehand illustration, precise native objects, and native diagram connectors. Use for scientific, technical, mechanism, anatomy, or process explanations that need presentation-quality visual hierarchy; do not use for simple doodles, icon sheets, or code-only architecture diagrams.
---

# Drawsy Teaching Diagrams

Build an editable Drawsy canvas that explains an idea visually, not a collection of decorative shapes. Preserve the distinction between three visual languages:

- **Freehand illustration** communicates organic form, gesture, anatomy, texture, and human explanation. It may be deliberately loose.
- **Native objects** communicate precise structure: panels, repeated components, membranes, nodes, graphs, containers, and other geometry where alignment matters.
- **Diagram marks** communicate relationships: arrows, lines, labels, callouts, sequence, cause-and-effect, and direction.

Use a deliberate mix. Sloppiness belongs inside the freehand language; it must not make labels, panels, connectors, or repeated structures look accidental.

## Workflow

### 1. Inspect the live canvas first

- Capture the current canvas view and read the current accessibility/tool state before editing.
- Confirm the active tab/canvas, title, zoom, frame bounds, existing artwork, and available empty space. Never reuse coordinates or accessibility indices from an earlier state without refreshing them.
- Preserve existing artwork unless the user asks for a new canvas or a redesign. If a source page, README, or attached reference is part of the request, inspect the actual source before claiming behavior or content.
- Choose a working zoom that keeps the whole composition visible. Keep all native gestures inside the current rendered canvas bounds.

### 2. Turn the explanation into a visual argument

Decide the teaching story before drawing:

1. What is the main subject or system?
2. What sequence, mechanism, or relationship must the viewer understand?
3. Which detail deserves an inset, graph, or close-up?
4. What should the viewer read first, second, and last?

Use a short title and, when useful, a one-line thesis or progression. Prefer one strong central illustration with a small number of purposeful detail regions over a grid of equally weighted boxes.

### 3. Route each idea to the right visual language

Use the Draw/freehand tool for:

- organic outlines and recognizable anatomy;
- hand-drawn pathways, currents, textures, and expressive emphasis;
- a teacher-like sketch that gives the diagram a human explanatory voice.

Use native rectangles, ellipses, lines, and other editable objects for:

- frames and detail insets;
- repeated structures that must align;
- precise circular or tubular components;
- graph axes, baselines, membranes, nodes, and containers.

Use native arrows, lines, and text for:

- signal direction and sequence;
- cause-to-effect relationships;
- labels anchored near the thing they describe;
- short explanatory callouts.

Do not use a freehand stroke as a substitute for a precise connector when the relationship needs an unmistakable arrowhead. Do not use native shapes for every part of an organic subject merely because they are easier; that produces a shape diagram instead of an explanatory sketch.

### 4. Compose before detailing

- Establish the outer frame or presentation area, title, reading direction, and major zones first.
- Reserve the largest area for the main freehand subject. Reserve smaller, clearly separated areas for mechanism insets, graphs, or micro-structure.
- Keep consistent visual hierarchy: the main subject has the strongest presence, connectors are quieter, labels are legible but subordinate, and detail insets are bounded.
- Use a restrained semantic palette. Reuse a color for a role such as structure, signal, output, or annotation instead of assigning random colors to individual objects.
- Leave enough negative space around the subject and labels for the diagram to read at a glance.

### 5. Build in passes

Work in this order unless the canvas already has a strong structure:

1. Add the frame/title and major empty regions.
2. Draw the main freehand illustration with a few confident, readable strokes.
3. Add only the native objects needed for precise structural detail.
4. Add directional arrows and relationship lines after the endpoints exist.
5. Add labels and short annotations close to their targets.
6. Add a graph, waveform, inset, or final emphasis only if it teaches a real mechanism.

Inspect after each pass. Fix overlaps, unclear arrow landings, clipped text, and crowded regions before adding more detail. A detailed diagram is not one with more marks; it is one where each mark earns its place.

## Native-tool discipline

- Operate the actual Drawsy canvas tools through the available native browser/canvas control. Do not fake a cursor, paint a screenshot overlay, or mutate scene data directly when the request is for native drawing.
- Re-read accessibility state after selecting a tool, opening a style panel, or making a selection because control indices can change.
- If the Draw tool exposes only a drag gesture, compose organic curves from short connected segments. Keep joins intentional, vary the path naturally, and avoid noisy jitter. Re-select the Draw tool for each segment when the interface does not keep it active.
- Use native objects for editable geometry and native text for labels. If the user asks for pencil/freehand, interpret that as the actual Draw/freehand tool, not a series of rectangles or ellipses.
- Keep the selection tool available for cleanup. Deselect before the final inspection so handles and selection boxes do not obscure the result.

## Teaching-quality review

Before handing off, verify the rendered canvas—not only tool responses:

- The main subject is recognizable without reading every label.
- The reading order is obvious from layout and arrows.
- Every arrow has a meaningful source and destination; remove floating or decorative arrows.
- Labels are close enough to their targets, do not overlap each other, and remain readable at the working zoom.
- Freehand marks look intentional and organic, while native panels and repeated components remain aligned.
- Color, stroke weight, and sloppiness are consistent within each visual language.
- The diagram explains a mechanism or relationship rather than merely naming parts.
- Scientific or technical labels and directionality are correct. If domain facts are uncertain, verify them or state the uncertainty rather than decorating around it.
- The final composition has no accidental merges, wrapped labels, clipped content, or object collisions.

Use a final screenshot, and refresh accessibility state when the environment supports it. Treat a successful gesture message as incomplete evidence if the mark is not visibly persisted. If native ink fails to persist, retry inside the verified canvas bounds; when the user allows mixed tools, use an editable structured fallback while preserving the intended freehand-versus-object distinction. If the user explicitly requires genuine freehand ink, do not silently replace it with shapes—report the boundary.

If the canvas interface exposes a deliverable or handoff marker, mark it only after the final deselection and visual review. Report exactly what was visually verified and distinguish it from any unresolved structural diagnostic.

## Reusable composition patterns

For a scientific or anatomy explanation, use a large freehand subject as the visual anchor, then add one or two native insets for micro-structure, a waveform or graph, and a synapse/mechanism close-up. Connect the stages with native arrows and short labels. This preserves the human sketch while making the difficult mechanism precise.

For a process explanation, let the main subject or scene carry the freehand context. Use a limited number of native nodes or containers only where grouping or sequence truly needs precision. Add arrows after node placement and label the transformation at the point where it happens.

For a presentation-style canvas, prefer one frame with clear hierarchy over many equal cards. Make the title, central subject, mechanism inset, and final takeaway visually distinct before adding decorative detail.

## Avoid

- Reducing the entire explanation to identical boxes, circles, and arrows.
- Treating “sloppy” as permission for misaligned text, unreadable labels, or ambiguous connectors.
- Placing labels in empty space without a clear target.
- Adding detail before the central causal story is readable.
- Claiming completion from a tool response without a rendered visual check.
- Reusing stale tab IDs, coordinates, or accessibility indices without inspecting the live surface first.
