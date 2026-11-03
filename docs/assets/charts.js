// Small SVG charts keep this static site dependency-free and inspectable.
// All numeric paths come from the backtester. Labels are escaped before markup.
const NS = "http://www.w3.org/2000/svg";
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function chart(
  container,
  {
    rows,
    lines,
    title,
    yFormat,
    tooltip,
    bands = [],
    markers = [],
    shadeUntil = null,
    zero = false,
    fill = true,
  },
) {
  if (!rows.length) {
    container.textContent = "No observations to display.";
    return;
  }
  const W = Math.max(container.clientWidth - 10, 250),
    H = container.clientHeight;
  const padding = { left: 54, right: 19, top: 21, bottom: 31 };
  const plotW = W - padding.left - padding.right,
    plotH = H - padding.top - padding.bottom;
  const finite = lines
    .flatMap((line) => rows.map(line.value))
    .filter((v) => v !== null && Number.isFinite(v));
  finite.push(...bands.map((b) => b.value));
  if (zero) finite.push(0);
  let low = Math.min(...finite),
    high = Math.max(...finite);
  const span = high - low || Math.abs(high) * 0.1 || 1;
  low -= span * 0.1;
  high += span * 0.1;
  const x = (i) => padding.left + (i / Math.max(rows.length - 1, 1)) * plotW;
  const y = (v) => padding.top + ((high - v) / (high - low)) * plotH;
  const bottom = padding.top + plotH;
  let markup = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHTML(title)}. Use left and right arrow keys to inspect dates." tabindex="0"><title>${escapeHTML(title)}</title><defs><clipPath id="${container.id}-clip"><rect x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}"/></clipPath><linearGradient id="${container.id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${lines[0].color}" stop-opacity=".10"/><stop offset="100%" stop-color="${lines[0].color}" stop-opacity=".005"/></linearGradient></defs>`;
  for (let i = 0; i < 5; i++) {
    const value = low + ((high - low) * i) / 4,
      py = y(value);
    markup += `<line class="grid-line" x1="${padding.left}" x2="${W - padding.right}" y1="${py}" y2="${py}"/><text x="${padding.left - 10}" y="${py + 3}" text-anchor="end">${escapeHTML(yFormat(value))}</text>`;
  }
  if (shadeUntil !== null) {
    const end = rows.findIndex((r) => r.index >= shadeUntil);
    if (end > 0) {
      markup += `<rect x="${padding.left}" y="${padding.top}" width="${x(end) - padding.left}" height="${plotH}" fill="#eef2e9" opacity=".7"/><line class="band-line" x1="${x(end)}" x2="${x(end)}" y1="${padding.top}" y2="${bottom}"/><text x="${padding.left + 9}" y="${padding.top + 12}" class="axis-text">FORMATION</text>`;
    }
  }
  for (const band of bands) {
    markup += `<line class="band-line" x1="${padding.left}" x2="${W - padding.right}" y1="${y(band.value)}" y2="${y(band.value)}"/>`;
  }
  const ticks = W < 440 ? 4 : 6;
  for (let i = 0; i < ticks; i++) {
    const index = Math.round(((rows.length - 1) * i) / (ticks - 1));
    const label = new Date(rows[index].date + "T00:00:00Z").toLocaleDateString(
      "en-US",
      { month: "short", year: "2-digit", timeZone: "UTC" },
    );
    markup += `<text class="axis-text" x="${x(index)}" y="${H - 10}" text-anchor="${i === 0 ? "start" : i === ticks - 1 ? "end" : "middle"}">${label}</text>`;
  }
  markup += `<g clip-path="url(#${container.id}-clip)">`;
  for (const [lineIndex, line] of lines.entries()) {
    let path = "",
      previousValid = false;
    for (let i = 0; i < rows.length; i++) {
      const value = line.value(rows[i]);
      if (value === null || !Number.isFinite(value)) {
        previousValid = false;
        continue;
      }
      path += `${previousValid ? "L" : "M"}${x(i).toFixed(2)},${y(value).toFixed(2)}`;
      previousValid = true;
    }
    if (
      lineIndex === 0 &&
      fill &&
      path &&
      rows.every((r) => line.value(r) !== null)
    ) {
      markup += `<path d="${path}L${x(rows.length - 1)},${bottom}L${x(0)},${bottom}Z" fill="url(#${container.id}-fill)"/>`;
    }
    markup += `<path d="${path}" class="chart-line" stroke="${line.color}"${line.dashed ? ' stroke-dasharray="3 4"' : ""} opacity="${line.opacity ?? 1}"/>`;
  }
  for (const marker of markers) {
    const i = rows.findIndex((r) => r.index === marker.index);
    if (i < 0 || rows[i].z === null) continue;
    const px = x(i),
      py = y(rows[i].z);
    if (marker.kind === "entry")
      markup += `<path d="M${px},${py - 4}l-3.5,6h7Z" fill="#3c7f68" stroke="#fff" stroke-width=".6"/>`;
    else
      markup += `<path d="M${px},${py - 3}l3,3 -3,3 -3,-3Z" fill="#ab9473" stroke="#fff" stroke-width=".6"/>`;
  }
  markup += `</g><line class="chart-crosshair" y1="${padding.top}" y2="${bottom}" visibility="hidden"/><circle class="hover-dot" r="3" fill="${lines[0].color}" stroke="white" stroke-width="1.5" visibility="hidden"/></svg>`;
  container.innerHTML = markup;
  const svg = container.querySelector("svg"),
    crosshair = svg.querySelector(".chart-crosshair"),
    dot = svg.querySelector(".hover-dot");
  const tip = document.createElement("div");
  tip.className = "chart-tooltip";
  tip.hidden = true;
  container.append(tip);
  let selected = rows.length - 1;
  function show(index) {
    selected = Math.max(0, Math.min(rows.length - 1, index));
    const px = x(selected),
      value = lines[0].value(rows[selected]);
    crosshair.setAttribute("x1", px);
    crosshair.setAttribute("x2", px);
    crosshair.setAttribute("visibility", "visible");
    if (value !== null) {
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", y(value));
      dot.setAttribute("visibility", "visible");
    } else dot.setAttribute("visibility", "hidden");
    tip.replaceChildren();
    const date = document.createElement("span");
    date.textContent = rows[selected].date;
    tip.append(date);
    const values = document.createElement("div");
    values.textContent = tooltip(rows[selected]);
    tip.append(values);
    tip.hidden = false;
    tip.style.left =
      Math.max(5, Math.min(W - tip.offsetWidth - 5, px + 15)) + "px";
  }
  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) * W) / bounds.width;
    show(Math.round(((px - padding.left) / plotW) * (rows.length - 1)));
  });
  function hide() {
    tip.hidden = true;
    crosshair.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
  }
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      show(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : selected + (event.key === "ArrowLeft" ? -1 : 1),
      );
    }
  });
}
