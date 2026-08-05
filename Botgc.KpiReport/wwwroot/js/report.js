const SVG_NS = "http://www.w3.org/2000/svg";
const palette = ["#43afbf", "#a7d43e", "#f3c600", "#f39a00", "#e20d00", "#8ad8dd", "#d4e88a", "#6f9fae", "#ffffff", "#287b92"];
const teePalette = [
  "#567d22",
  "#638c25",
  "#719b28",
  "#80aa2b",
  "#8fba2e",
  "#9dca32",
  "#abd755",
  "#b9df72",
  "#c7e68f",
  "#d4ebab",
  "#dfeec1",
  "#e8f1d2",
  "#eff4df",
  "#f4f6e9"
];

const teeUnusedColour =
  "#49acbd";

function svgElement(tag, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }

  if (text !== null) {
    element.textContent = text;
  }

  return element;
}

function createSvg(container, width, height) {
  container.replaceChildren();

  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "presentation",
    preserveAspectRatio: "xMidYMid meet"
  });

  container.append(svg);

  return svg;
}

function setText(id, value) {
  document.getElementById(id).textContent = value ?? "";
}

function sum(items) {
  return items.reduce(
    (total, item) =>
      total + Number(item.value ?? item),
    0
  );
}

function currency(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function compactCurrency(value) {
  const absolute = Math.abs(value);

  if (absolute >= 1000000) {
    return `£${(value / 1000000).toFixed(1)}m`;
  }

  if (absolute >= 1000) {
    return `£${Math.round(value / 1000)}k`;
  }

  return currency(value);
}

function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined) {
    return "—";
  }

  return Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function pathFromPoints(points) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`
    )
    .join(" ");
}

function polar(cx, cy, radius, degrees) {
  const radians =
    (degrees - 90) *
    Math.PI /
    180;

  return [
    cx + radius * Math.cos(radians),
    cy + radius * Math.sin(radians)
  ];
}

function ringArcPath(
  cx,
  cy,
  outerRadius,
  innerRadius,
  startDegrees,
  endDegrees
) {
  const startOuter =
    polar(cx, cy, outerRadius, endDegrees);

  const endOuter =
    polar(cx, cy, outerRadius, startDegrees);

  const startInner =
    polar(cx, cy, innerRadius, startDegrees);

  const endInner =
    polar(cx, cy, innerRadius, endDegrees);

  const largeArc =
    endDegrees - startDegrees > 180
      ? 1
      : 0;

  return [
    `M ${startOuter[0]} ${startOuter[1]}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter[0]} ${endOuter[1]}`,
    `L ${startInner[0]} ${startInner[1]}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner[0]} ${endInner[1]}`,
    "Z"
  ].join(" ");
}

function addChartText(
  svg,
  x,
  y,
  value,
  options = {}
) {
  const text = svgElement(
    "text",
    {
      x,
      y,
      "text-anchor":
        options.anchor ?? "middle",
      "font-size":
        options.size ?? 12,
      "font-weight":
        options.weight ?? 400,
      opacity:
        options.opacity ?? 1
    },
    value
  );

  svg.append(text);

  return text;
}

function drawLineAreaChart(container, chart) {
  const width = 820;
  const height = 360;

  const margin = {
    top: 18,
    right: 18,
    bottom: 42,
    left: 68
  };

  const svg =
    createSvg(container, width, height);

  const forecastValues =
    Array.isArray(chart.forecast)
      ? chart.forecast
      : [];

  const values = [
    ...chart.target,
    ...chart.actual.filter(
      value => value !== null
    ),
    ...forecastValues.filter(
      value => value !== null
    )
  ];

  const rawMin =
    Math.min(0, ...values);

  const rawMax =
    Math.max(0, ...values);

  const interval =
    rawMax > 50000
      ? 10000
      : 5000;

  const yMin =
    Math.floor(rawMin / interval) *
    interval;

  const yMax =
    Math.ceil(rawMax / interval) *
    interval;

  const plotWidth =
    width -
    margin.left -
    margin.right;

  const plotHeight =
    height -
    margin.top -
    margin.bottom;

  const x = index =>
    margin.left +
    plotWidth *
    index /
    Math.max(
      chart.labels.length - 1,
      1
    );

  const y = value =>
    margin.top +
    (
      yMax - value
    ) /
    Math.max(
      yMax - yMin,
      1
    ) *
    plotHeight;

  for (
    let value = yMin;
    value <= yMax;
    value += interval
  ) {
    const yPosition = y(value);

    svg.append(
      svgElement("line", {
        x1: margin.left,
        y1: yPosition,
        x2: width - margin.right,
        y2: yPosition,
        stroke: "rgba(255,255,255,.30)",
        "stroke-width": 1
      })
    );

    addChartText(
      svg,
      margin.left - 9,
      yPosition + 4,
      compactCurrency(value),
      {
        anchor: "end",
        size: 10,
        opacity: 0.78
      }
    );
  }

  chart.labels.forEach(
    (label, index) => {
      addChartText(
        svg,
        x(index),
        height - 14,
        label,
        {
          size: 11,
          opacity: 0.85
        }
      );
    }
  );

  const targetPoints =
    chart.target.map(
      (value, index) => [
        x(index),
        y(value)
      ]
    );

  const baseline = y(0);

  const areaPath =
    `${pathFromPoints(targetPoints)} ` +
    `L ${x(chart.target.length - 1)} ${baseline} ` +
    `L ${x(0)} ${baseline} Z`;

  svg.append(
    svgElement("path", {
      d: areaPath,
      fill: "rgba(67,175,191,.74)",
      stroke: "#67c6cf",
      "stroke-width": 1.5
    })
  );

  const forecastEntries =
    forecastValues
      .map((value, index) => {
        if (
          value === null ||
          value === undefined
        ) {
          return null;
        }

        return {
          value,
          index,
          point: [
            x(index),
            y(value)
          ]
        };
      })
      .filter(Boolean);

  if (forecastEntries.length > 1) {
    const forecastPoints =
      forecastEntries.map(
        entry => entry.point
      );

    svg.append(
      svgElement("path", {
        d: pathFromPoints(
          forecastPoints
        ),
        fill: "none",
        stroke: "#f3c600",
        "stroke-width": 2.5,
        "stroke-dasharray": "7 6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );

    const forecastEnd =
      forecastEntries[
        forecastEntries.length - 1
      ];

    svg.append(
      svgElement("circle", {
        cx: forecastEnd.point[0],
        cy: forecastEnd.point[1],
        r: 3.5,
        fill: "#f3c600"
      })
    );

    const forecastLabelY =
      forecastEnd.point[1] <
      margin.top + 20
        ? forecastEnd.point[1] + 18
        : forecastEnd.point[1] - 8;

    addChartText(
      svg,
      forecastEnd.point[0] - 8,
      forecastLabelY,
      `Forecast ${currency(
        forecastEnd.value
      )}`,
      {
        anchor: "end",
        size: 10,
        weight: 700
      }
    );
  }

  const actualEntries =
    chart.actual
      .map((value, index) => {
        if (
          value === null ||
          value === undefined
        ) {
          return null;
        }

        return {
          value,
          index,
          point: [
            x(index),
            y(value)
          ]
        };
      })
      .filter(Boolean);

  const actualPoints =
    actualEntries.map(
      entry => entry.point
    );

  if (actualPoints.length > 0) {
    svg.append(
      svgElement("path", {
        d: pathFromPoints(
          actualPoints
        ),
        fill: "none",
        stroke: "#d4e88a",
        "stroke-width": 2.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );
  }

  actualEntries.forEach(entry => {
    svg.append(
      svgElement("circle", {
        cx: entry.point[0],
        cy: entry.point[1],
        r: 3.2,
        fill: "#d4e88a"
      })
    );

    if (entry.index > 0) {
      addChartText(
        svg,
        entry.point[0] + 8,
        entry.point[1] - 8,
        currency(entry.value),
        {
          anchor: "start",
          size: 10,
          weight: 700
        }
      );
    }
  });
}

function drawDonut(
  container,
  items,
  centreLines,
  options = {}
) {
  const width =
    options.width ?? 360;

  const height =
    options.height ?? 310;

  const cx =
    options.cx ?? width / 2;

  const cy =
    options.cy ?? height / 2;

  const outerRadius =
    options.outerRadius ?? 118;

  const innerRadius =
    options.innerRadius ?? 72;

  const explodeOffset =
    options.explodeOffset ?? 18;

  const segmentGap =
    options.segmentGap ?? 0;

  const labelMinimumAngle =
    options.labelMinimumAngle ?? 24;

  const svg =
    createSvg(container, width, height);

  const total = sum(items);

  let angle =
    options.startAngle ?? 0;

  items.forEach((item, index) => {
    const value =
      Math.max(
        Number(item.value) || 0,
        0
      );

    const segment =
      total === 0
        ? 0
        : value / total * 360;

    const endAngle =
      angle + segment;

    const middleAngle =
      angle + segment / 2;

    const actualGap =
      Math.min(
        segmentGap,
        segment * 0.35
      );

    const drawStartAngle =
      angle + actualGap / 2;

    const drawEndAngle =
      endAngle - actualGap / 2;

    const offset =
      item.exploded
        ? explodeOffset
        : 0;

    const [
      offsetX,
      offsetY
    ] = polar(
      0,
      0,
      offset,
      middleAngle
    );

    const segmentCx =
      cx + offsetX;

    const segmentCy =
      cy + offsetY;

    svg.append(
      svgElement("path", {
        d: ringArcPath(
          segmentCx,
          segmentCy,
          outerRadius,
          innerRadius,
          drawStartAngle,
          drawEndAngle
        ),

        fill:
          item.color ??
          palette[
            index %
            palette.length
          ],

        stroke:
          item.exploded
            ? "#a70800"
            : "rgba(0, 0, 0, 0.12)",

        "stroke-width":
          item.exploded
            ? 3
            : 1
      })
    );

    if (
      segment >=
      labelMinimumAngle
    ) {
      const labelPoint =
        polar(
          segmentCx,
          segmentCy,
          (
            outerRadius +
            innerRadius
          ) / 2,
          middleAngle
        );

      const percentage =
        total === 0
          ? 0
          : value / total * 100;

      const label =
        typeof options.labelFormatter ===
          "function"
          ? options.labelFormatter(
              item,
              percentage
            )
          : formatNumber(item.value);

      addChartText(
        svg,
        labelPoint[0],
        labelPoint[1] + 4,
        label,
        {
          size:
            options.labelSize ??
            13,

          weight: 700
        }
      );
    }

    angle = endAngle;
  });

  const lines =
    Array.isArray(centreLines)
      ? centreLines
      : [centreLines];

  if (lines.length > 0) {
    const startY =
      cy -
      (
        lines.length - 1
      ) *
      14;

    lines.forEach((line, index) => {
      addChartText(
        svg,
        cx,
        startY + index * 28,
        line,
        {
          size:
            index ===
            lines.length - 1
              ? 21
              : 17,

          weight:
            index ===
            lines.length - 1
              ? 700
              : 450
        }
      );
    });
  }
}

function renderOutgoingsSummary(
  outgoings
) {
  const container =
    document.getElementById(
      "outgoings-summary"
    );

  const hasCalculatedValues =
    outgoings?.isCalculated === true &&
    outgoings.subscriptionIncome !==
      null &&
    outgoings.subscriptionIncome !==
      undefined &&
    outgoings.totalOutgoings !==
      null &&
    outgoings.totalOutgoings !==
      undefined;

  container.hidden =
    !hasCalculatedValues;

  container.replaceChildren();

  if (!hasCalculatedValues) {
    return;
  }

  const values = [
    {
      label: "Subscription income",
      value:
        outgoings.subscriptionIncome
    },
    {
      label: "Relevant outgoings",
      value:
        outgoings.totalOutgoings
    },
    {
      label: "Funding gap",
      value:
        outgoings.otherIncomeRequired
    }
  ];

  const list =
    document.createElement("dl");

  values.forEach(item => {
    const row =
      document.createElement("div");

    const term =
      document.createElement("dt");

    const value =
      document.createElement("dd");

    term.textContent =
      item.label;

    value.textContent =
      currency(item.value);

    row.append(term, value);
    list.append(row);
  });

  container.append(list);
}

function renderLegend(
  container,
  items,
  options = {}
) {
  container.replaceChildren();

  items.forEach((item, index) => {
    const entry =
      document.createElement("span");

    entry.className =
      "legend-entry";

    const swatch =
      document.createElement("i");

    swatch.className =
      "legend-swatch";

    swatch.style.background =
      item.color ??
      palette[
        index %
        palette.length
      ];

    entry.append(
      swatch,
      document.createTextNode(
        item.label
      )
    );

    if (
      typeof options.valueFormatter ===
        "function"
    ) {
      const value =
        document.createElement("strong");

      value.textContent =
        options.valueFormatter(item);

      entry.append(value);
    }

    container.append(entry);
  });
}

function drawStackedAreaChart(
  container,
  data
) {
  const width = 600;
  const height = 450;

  const margin = {
    top: 18,
    right: 14,
    bottom: 58,
    left: 58
  };
  
  const svg =
    createSvg(container, width, height);

  const plotWidth =
    width -
    margin.left -
    margin.right;

  const plotHeight =
    height -
    margin.top -
    margin.bottom;

  const x = index =>
    margin.left +
    plotWidth *
    index /
    Math.max(
      data.days.length - 1,
      1
    );

  const y = value =>
    margin.top +
    (
      100 - value
    ) /
    100 *
    plotHeight;

  for (
    let value = 0;
    value <= 100;
    value += 20
  ) {
    const yPosition = y(value);

    svg.append(
      svgElement("line", {
        x1: margin.left,
        y1: yPosition,
        x2: width - margin.right,
        y2: yPosition,
        stroke: "rgba(255,255,255,.24)",
        "stroke-width": 1
      })
    );

    addChartText(
      svg,
      margin.left - 7,
      yPosition + 4,
      `${value}%`,
      {
        anchor: "end",
        size: 10,
        opacity: 0.78
      }
    );
  }

  data.days.forEach(
    (day, index) => {
      addChartText(
        svg,
        x(index),
        height - 19,
        day.slice(0, 3),
        {
          size: 10,
          opacity: 0.88
        }
      );
    }
  );

  const contributions =
    data.rows.map(row => {
      const suppliedContributions =
        Array.isArray(
          row.contributions
        ) &&
        row.contributions.length ===
          data.days.length
          ? row.contributions.map(Number)
          : null;

      if (
        suppliedContributions &&
        suppliedContributions.every(
          Number.isFinite
        )
      ) {
        return suppliedContributions;
      }

      /*
      * Legacy fallback for reports created before
      * weighted tee-time data was imported.
      */
      return row.values.map(
        value =>
          value /
          data.capacityDivisor
      );
    });

  const occupied =
    data.days.map(
      (_, dayIndex) =>
        contributions.reduce(
          (total, row) =>
            total +
            row[dayIndex],
          0
        )
    );

  const unused =
    occupied.map(
      value =>
        Math.max(0, 100 - value)
    );

  const series = [
    ...contributions,
    unused
  ];

  const cumulative =
    data.days.map(() => 0);

  series.forEach(
    (values, seriesIndex) => {
      const lower = [
        ...cumulative
      ];

      const upper =
        values.map(
          (value, dayIndex) => {
            cumulative[dayIndex] +=
              value;

            return cumulative[
              dayIndex
            ];
          }
        );

      const topPoints =
        upper.map(
          (value, dayIndex) => [
            x(dayIndex),
            y(value)
          ]
        );

      const lowerPoints =
        lower
          .map(
            (value, dayIndex) => [
              x(dayIndex),
              y(value)
            ]
          )
          .reverse();

      const path =
        `${pathFromPoints(topPoints)} ` +
        `${lowerPoints
          .map(
            point =>
              `L ${point[0]} ${point[1]}`
          )
          .join(" ")} Z`;

      svg.append(
        svgElement("path", {
          d: path,
          fill:
            seriesIndex ===
            series.length - 1
              ? teeUnusedColour
              : teePalette[
                  seriesIndex %
                  teePalette.length
                ],

          stroke:
            "rgba(255,255,255,0.18)",

          "stroke-width": 0.7,

          opacity:
            seriesIndex ===
            series.length - 1
              ? 0.88
              : 0.96
        })
      );
    }
  );
}

function drawMembershipTrendChart(container, data) {
  if (!container) {
    return;
  }

  const width = 820;
  const height = 430;

  const margin = {
    top: 34,
    right: 26,
    bottom: 54,
    left: 58
  };

  const svg = createSvg(
    container,
    width,
    height
  );

  const parseDate = value => {
    if (!value) {
      return null;
    }

    const parts = String(value)
      .split("-")
      .map(Number);

    if (
      parts.length !== 3 ||
      parts.some(Number.isNaN)
    ) {
      return null;
    }

    return new Date(
      parts[0],
      parts[1] - 1,
      parts[2]
    );
  };

  const dates = Array.isArray(data?.dates)
    ? data.dates.map(parseDate)
    : [];

  const playingMembers =
    Array.isArray(data?.playingMembers)
      ? data.playingMembers
      : [];

  const nonPlayingMembers =
    Array.isArray(data?.nonPlayingMembers)
      ? data.nonPlayingMembers
      : [];

  const playingTarget =
    Array.isArray(data?.playingTarget)
      ? data.playingTarget
      : [];

  const financialYearStart =
    parseDate(data?.financialYearStart);

  const financialYearEnd =
    parseDate(data?.financialYearEnd);

  const figuresCorrectAsAt =
    parseDate(data?.figuresCorrectAsAt);

  const buildSeries = values =>
    dates
      .map((date, index) => {
        const numericValue =
          Number(values[index]);

        if (
          !date ||
          values[index] === null ||
          values[index] === undefined ||
          !Number.isFinite(numericValue)
        ) {
          return null;
        }

        return {
          date,
          value: numericValue
        };
      })
      .filter(Boolean);

  const playingSeries =
    buildSeries(playingMembers);

  const nonPlayingSeries =
    buildSeries(nonPlayingMembers);

  const targetSeries =
    buildSeries(playingTarget)
      .filter(entry => entry.value > 0);

  const validDates =
    dates.filter(Boolean);

  const allValues = [
    ...playingSeries,
    ...nonPlayingSeries,
    ...targetSeries
  ].map(entry => entry.value);

  if (
    validDates.length === 0 ||
    allValues.length === 0
  ) {
    addChartText(
      svg,
      width / 2,
      height / 2,
      "Membership data has not been imported.",
      {
        size: 13,
        opacity: 0.8
      }
    );

    return;
  }

  const chartStart = new Date(
    Math.min(
      ...validDates.map(
        date => date.getTime()
      )
    )
  );

  const chartEnd = new Date(
    Math.max(
      ...validDates.map(
        date => date.getTime()
      )
    )
  );

  const chartStartTime =
    chartStart.getTime();

  const chartEndTime =
    chartEnd.getTime();

  const chartDuration =
    Math.max(
      chartEndTime - chartStartTime,
      1
    );

  /*
 * Plot the complete extended date range, but calculate
 * the Y-axis from values inside the financial year only.
 */
const isWithinFinancialYear = entry => {
  if (!entry?.date) {
    return false;
  }

  const entryTime =
    entry.date.getTime();

  const financialYearStartTime =
    financialYearStart?.getTime();

  const financialYearEndTime =
    financialYearEnd?.getTime();

  return (
    (
      financialYearStartTime === undefined ||
      entryTime >= financialYearStartTime
    ) &&
    (
      financialYearEndTime === undefined ||
      entryTime <= financialYearEndTime
    )
  );
};

const inYearActualValues = [
  ...playingSeries.filter(
    isWithinFinancialYear
  ),
  ...nonPlayingSeries.filter(
    isWithinFinancialYear
  )
].map(entry => entry.value);

const inYearTargetValues =
  targetSeries
    .filter(isWithinFinancialYear)
    .map(entry => entry.value);

/*
 * Fall back to the complete actual series only if the
 * report contains no points inside the financial year.
 */
const axisActualValues =
  inYearActualValues.length > 0
    ? inYearActualValues
    : [
        ...playingSeries,
        ...nonPlayingSeries
      ].map(entry => entry.value);

const axisMaximumValues = [
  ...axisActualValues,
  ...inYearTargetValues
];

const rawMinimum =
  Math.min(...axisActualValues);

const rawMaximum =
  Math.max(...axisMaximumValues);

const rawRange =
  Math.max(
    rawMaximum - rawMinimum,
    1
  );

/*
 * Use readable grid increments while keeping the axis
 * tight to the meaningful financial-year values.
 */
const interval =
  rawRange <= 60
    ? 10
    : rawRange <= 200
      ? 25
      : rawRange <= 400
        ? 50
        : 100;

/*
 * Provide slightly more room below the lowest in-year
 * value than above the highest. Values outside the
 * financial year may therefore be clipped, deliberately.
 */
const lowerPadding =
  interval * 1.5;

const upperPadding =
  interval * 0.75;

let yMinimum =
  Math.floor(
    (rawMinimum - lowerPadding) /
    interval
  ) * interval;

let yMaximum =
  Math.ceil(
    (rawMaximum + upperPadding) /
    interval
  ) * interval;

if (yMinimum < 0) {
  yMinimum = 0;
}

if (yMaximum <= yMinimum) {
  yMaximum =
    yMinimum + interval;
}

  const plotWidth =
    width -
    margin.left -
    margin.right;

  const plotHeight =
    height -
    margin.top -
    margin.bottom;

  const plotBottom =
    margin.top +
    plotHeight;

  const membershipClipId =
    "membership-trend-plot-clip";

  const definitions =
    svgElement("defs");

  const clipPath =
    svgElement("clipPath", {
      id: membershipClipId
    });

  clipPath.append(
    svgElement("rect", {
      x: margin.left,
      y: margin.top,
      width: plotWidth,
      height: plotHeight
    })
  );

  definitions.append(clipPath);
  svg.append(definitions);

  const x = date =>
    margin.left +
    (
      date.getTime() -
      chartStartTime
    ) /
    chartDuration *
    plotWidth;

  const y = value =>
    margin.top +
    (
      yMaximum - value
    ) /
    Math.max(
      yMaximum - yMinimum,
      1
    ) *
    plotHeight;

  /*
   * Highlight the central financial-year section.
   */
  if (
    financialYearStart &&
    financialYearEnd
  ) {
    const financialYearStartX =
      x(financialYearStart);

    const financialYearEndX =
      x(financialYearEnd);

    svg.append(
      svgElement("rect", {
        x: financialYearStartX,
        y: margin.top,
        width: Math.max(
          financialYearEndX -
          financialYearStartX,
          0
        ),
        height: plotHeight,
        fill: "rgba(255,255,255,.055)"
      })
    );

    [
      financialYearStart,
      financialYearEnd
    ].forEach(date => {
      const xPosition = x(date);

      svg.append(
        svgElement("line", {
          x1: xPosition,
          y1: margin.top,
          x2: xPosition,
          y2: plotBottom,
          stroke: "rgba(255,255,255,.72)",
          "stroke-width": 1.25
        })
      );
    });

    const financialYearLabel =
      data?.financialYearLabel
        ? `Financial year ${data.financialYearLabel}`
        : "Financial year";

    addChartText(
      svg,
      (
        financialYearStartX +
        financialYearEndX
      ) / 2,
      margin.top - 12,
      financialYearLabel,
      {
        size: 10,
        weight: 700,
        opacity: 0.9
      }
    );
  }

  /*
   * Horizontal member-count grid.
   */
  for (
    let value = yMinimum;
    value <= yMaximum;
    value += interval
  ) {
    const yPosition = y(value);

    svg.append(
      svgElement("line", {
        x1: margin.left,
        y1: yPosition,
        x2: width - margin.right,
        y2: yPosition,
        stroke: "rgba(255,255,255,.22)",
        "stroke-width": 1
      })
    );

    addChartText(
      svg,
      margin.left - 9,
      yPosition + 4,
      formatNumber(value),
      {
        anchor: "end",
        size: 10,
        opacity: 0.78
      }
    );
  }

  /*
   * Monthly grid. With an approximately two-year
   * range, show every second month to avoid crowding.
   */
  const totalMonths =
    (
      chartEnd.getFullYear() -
      chartStart.getFullYear()
    ) * 12 +
    chartEnd.getMonth() -
    chartStart.getMonth() +
    1;

  const monthStep =
    totalMonths > 18
      ? 2
      : 1;

  const tickDate = new Date(
    chartStart.getFullYear(),
    chartStart.getMonth(),
    1
  );

  let monthIndex = 0;

  while (tickDate <= chartEnd) {
    const xPosition = x(tickDate);

    svg.append(
      svgElement("line", {
        x1: xPosition,
        y1: margin.top,
        x2: xPosition,
        y2: plotBottom,
        stroke: "rgba(255,255,255,.10)",
        "stroke-width": 1
      })
    );

    if (monthIndex % monthStep === 0) {
      addChartText(
        svg,
        xPosition,
        height - 18,
        new Intl.DateTimeFormat(
          "en-GB",
          {
            month: "short",
            year: "2-digit"
          }
        ).format(tickDate),
        {
          size: 9,
          opacity: 0.82
        }
      );
    }

    tickDate.setMonth(
      tickDate.getMonth() + 1
    );

    monthIndex += 1;
  }

  function drawAreaSeries(
    series,
    stroke,
    fill
  ) {
    if (series.length === 0) {
      return;
    }

    const points = series.map(
      entry => [
        x(entry.date),
        y(entry.value)
      ]
    );

    const areaPath =
      `${pathFromPoints(points)} ` +
      `L ${points[points.length - 1][0]} ${plotBottom} ` +
      `L ${points[0][0]} ${plotBottom} Z`;

    svg.append(
      svgElement("path", {
        d: areaPath,
        fill,
        stroke: "none",
        "clip-path":
          `url(#${membershipClipId})`
      })
    );

    svg.append(
      svgElement("path", {
        d: pathFromPoints(points),
        fill: "none",
        stroke,
        "stroke-width": 2.2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "clip-path":
          `url(#${membershipClipId})`
      })
    );
  }

  /*
   * Match the blue and green budget-chart palette.
   */
  drawAreaSeries(
    playingSeries,
    "#43afbf",
    "rgba(67,175,191,.52)"
  );

  drawAreaSeries(
    nonPlayingSeries,
    "#d4e88a",
    "rgba(212,232,138,.40)"
  );

  /*
   * Playing-member budget target.
   */
  if (targetSeries.length > 1) {
    const targetPoints =
      targetSeries.map(
        entry => [
          x(entry.date),
          y(entry.value)
        ]
      );

    svg.append(
      svgElement("path", {
        d: pathFromPoints(
          targetPoints
        ),
        fill: "none",
        stroke: "#8ad8dd",
        "stroke-width": 2,
        "stroke-dasharray": "6 5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );
  }

  const findValueAtDate = (
    series,
    date
  ) => {
    if (!date || series.length === 0) {
      return null;
    }

    const targetTime = date.getTime();

    const exact = series.find(
      entry =>
        entry.date.getTime() ===
        targetTime
    );

    if (exact) {
      return exact;
    }

    const earlier = series.filter(
      entry =>
        entry.date.getTime() <=
        targetTime
    );

    return earlier.length > 0
      ? earlier[earlier.length - 1]
      : null;
  };

  /*
   * Figures-correct-as-at marker and current labels.
   */
  if (figuresCorrectAsAt) {
    const asAtX = x(
      figuresCorrectAsAt
    );

    svg.append(
      svgElement("line", {
        x1: asAtX,
        y1: margin.top,
        x2: asAtX,
        y2: plotBottom,
        stroke: "#f3c600",
        "stroke-width": 2
      })
    );

    // addChartText(
    //   svg,
    //   Math.min(
    //     asAtX + 7,
    //     width - margin.right
    //   ),
    //   margin.top + 12,
    //   `As at ${new Intl.DateTimeFormat(
    //     "en-GB",
    //     {
    //       day: "numeric",
    //       month: "short",
    //       year: "numeric"
    //     }
    //   ).format(figuresCorrectAsAt)}`,
    //   {
    //     anchor: "start",
    //     size: 9,
    //     weight: 700
    //   }
    // );

    const playingAtDate =
      findValueAtDate(
        playingSeries,
        figuresCorrectAsAt
      );

    const nonPlayingAtDate =
      findValueAtDate(
        nonPlayingSeries,
        figuresCorrectAsAt
      );

    if (playingAtDate) {
      const label = addChartText(
        svg,
        Math.min(
          asAtX + 8,
          width - margin.right
        ),
        y(playingAtDate.value) - 8,
        `Playing ${formatNumber(
          playingAtDate.value
        )}`,
        {
          anchor: "start",
          size: 10,
          weight: 700
        }
      );

      label.setAttribute(
        "fill",
        "#8ad8dd"
      );
    }

    if (nonPlayingAtDate) {
      const label = addChartText(
        svg,
        Math.min(
          asAtX + 8,
          width - margin.right
        ),
        y(nonPlayingAtDate.value) + 15,
        `Non-playing ${formatNumber(
          nonPlayingAtDate.value
        )}`,
        {
          anchor: "start",
          size: 10,
          weight: 700
        }
      );

      label.setAttribute(
        "fill",
        "#d4e88a"
      );
    }
  }
}

function drawGauge(container, gauge) {
  const width = 220;
  const height = 145;
  const cx = width / 2;
  const cy = 112;
  const outerRadius = 84;
  const innerRadius = 57;

  const svg =
    createSvg(container, width, height);

  const bandTotal =
    gauge.bands.reduce(
      (total, value) =>
        total + value,
      0
    );

  const colours = [
    "#e20d00",
    "#f3c600",
    "#a7d43e"
  ];

  let angle = -90;

  gauge.bands.forEach(
    (band, index) => {
      const segment =
        band /
        bandTotal *
        180;

      svg.append(
        svgElement("path", {
          d: ringArcPath(
            cx,
            cy,
            outerRadius,
            innerRadius,
            angle,
            angle + segment
          ),
          fill:
            colours[
              index %
              colours.length
            ]
        })
      );

      angle += segment;
    }
  );

  const ratio =
    Math.max(
      0,
      Math.min(
        1,
        (
          gauge.value -
          gauge.minimum
        ) /
        (
          gauge.maximum -
          gauge.minimum
        )
      )
    );

  const needleAngle =
    -90 + ratio * 180;

  const needleEnd =
    polar(
      cx,
      cy,
      70,
      needleAngle
    );

  svg.append(
    svgElement("line", {
      x1: cx,
      y1: cy,
      x2: needleEnd[0],
      y2: needleEnd[1],
      stroke: "#ffffff",
      "stroke-width": 5,
      "stroke-linecap": "round"
    })
  );

  svg.append(
    svgElement("circle", {
      cx,
      cy,
      r: 7,
      fill: "#ffffff"
    })
  );

  addChartText(
    svg,
    22,
    126,
    `${gauge.prefix}${formatNumber(
      gauge.minimum,
      gauge.decimalPlaces
    )}${gauge.suffix}`,
    {
      anchor: "start",
      size: 8,
      opacity: 0.72
    }
  );

  addChartText(
    svg,
    width - 22,
    126,
    `${gauge.prefix}${formatNumber(
      gauge.maximum,
      gauge.decimalPlaces
    )}${gauge.suffix}`,
    {
      anchor: "end",
      size: 8,
      opacity: 0.72
    }
  );
}

function renderFinancialTable(rows) {
  const body =
    document.getElementById(
      "financial-table-body"
    );

  body.replaceChildren();

  rows.forEach(row => {
    const tr =
      document.createElement("tr");

    if (row.isTotal) {
      tr.classList.add("is-total");
    }

    const percentage =
      row.percentageVariance === null ||
      row.percentageVariance === undefined
        ? "—"
        : `${formatNumber(
            row.percentageVariance,
            2
          )}%`;

    const values = [
      row.label,
      currency(row.actual),
      currency(row.budget),
      currency(row.variance),
      percentage
    ];

    values.forEach(
      (value, index) => {
        const cell =
          document.createElement("td");

        cell.textContent = value;

        if (index >= 3) {
          const numeric =
            index === 3
              ? row.variance
              : row.percentageVariance;

          cell.className =
            numeric === null ||
            numeric === undefined
              ? ""
              : numeric < 0
                ? "value-negative"
                : numeric > 0
                  ? "value-positive"
                  : "";
        }

        tr.append(cell);
      }
    );

    body.append(tr);
  });
}

function formatTeeHour(hour) {
  const normalised =
    ((hour % 24) + 24) % 24;

  const suffix =
    normalised >= 12
      ? "pm"
      : "am";

  const displayHour =
    normalised % 12 || 12;

  return `${displayHour}${suffix}`;
}

function formatTeeTimeRange(value) {
  const match =
    /^(\d{2}):\d{2}\s*-\s*(\d{2}):\d{2}$/
      .exec(String(value ?? ""));

  if (!match) {
    return value ?? "";
  }

  const startHour =
    Number(match[1]);

  return (
    `${formatTeeHour(startHour)}` +
    `–${formatTeeHour(startHour + 1)}`
  );
}

function renderTeeTable(data) {
  const head =
    document.getElementById(
      "tee-table-head"
    );

  const body =
    document.getElementById(
      "tee-table-body"
    );

  head.replaceChildren();
  body.replaceChildren();

  const headerRow =
    document.createElement("tr");

  [
    "Time",
    ...data.days.map(
      day => day.slice(0, 3)
    )
  ].forEach(label => {
    const th =
      document.createElement("th");

    th.scope = "col";
    th.textContent = label;

    headerRow.append(th);
  });

  head.append(headerRow);

  data.rows.forEach(row => {
    const tr =
      document.createElement("tr");

    const timeCell =
      document.createElement("td");

    timeCell.textContent =
      formatTeeTimeRange(
        row.time
      );

    tr.append(timeCell);

    row.values.forEach(value => {
      const cell =
        document.createElement("td");

      cell.textContent =
        `${formatNumber(value)}%`;

      if (value >= 80) {
        cell.classList.add("is-high");
      }

      tr.append(cell);
    });

    body.append(tr);
  });

  const totalsRow =
    document.createElement("tr");

  totalsRow.className = "is-total";

  const totalLabel =
    document.createElement("td");

  totalLabel.textContent = "Total";

  totalsRow.append(totalLabel);

  data.totals.forEach(value => {
    const cell =
      document.createElement("td");

    cell.textContent =
      `${formatNumber(value)}%`;

    totalsRow.append(cell);
  });

  body.append(totalsRow);
}

function renderTeeLegend(data) {
  const container =
    document.getElementById(
      "tee-chart-legend"
    );

  if (!container) {
    return;
  }

  container.replaceChildren();

  const items = [
    {
      label: "Unused",
      colour: teeUnusedColour
    },
    ...data.rows.map(
      (row, index) => ({
        label:
          formatTeeTimeRange(
            row.time
          ),

        colour:
          teePalette[
            index %
            teePalette.length
          ]
      })
    )
  ];

  items.forEach(item => {
    const entry =
      document.createElement("span");

    entry.className =
      "tee-chart-legend__item";

    const swatch =
      document.createElement("i");

    swatch.className =
      "tee-chart-legend__swatch";

    swatch.style.background =
      item.colour;

    entry.append(
      swatch,
      document.createTextNode(
        item.label
      )
    );

    container.append(entry);
  });
}

function renderMembershipStatistics(
  containerId,
  statistics
) {
  const container =
    document.getElementById(
      containerId
    );

  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!statistics) {
    return;
  }

  const rows = [
    {
      value: statistics.newJoiners,
      label: "New members joined",
      tone: "positive"
    },
    {
      value: statistics.movedIn,
      label: "Moved into this membership type",
      tone: "positive"
    },
    {
      value: statistics.movedOut,
      label: "Moved out of this membership type",
      tone: "negative"
    },
    {
      value: statistics.leavers,
      label: "Memberships ended",
      tone: "negative"
    },
    {
      value: statistics.deaths,
      label: "Members passed away",
      tone: "negative"
    }
  ];

  rows.forEach(item => {
    const row =
      document.createElement("div");

    row.className = "movement-item";
    row.dataset.tone = item.tone;

    const value =
      document.createElement("strong");

    value.textContent =
      formatNumber(item.value);

    const label =
      document.createElement("span");

    label.textContent =
      item.label;

    row.append(value, label);
    container.append(row);
  });

  const netRow =
    document.createElement("div");

  netRow.className =
    "movement-item movement-item--summary";

  netRow.dataset.tone =
    statistics.netMovement < 0
      ? "negative"
      : statistics.netMovement > 0
        ? "positive"
        : "neutral";

  const netValue =
    document.createElement("strong");

  netValue.textContent =
    statistics.netMovement > 0
      ? `+${formatNumber(
          statistics.netMovement
        )}`
      : formatNumber(
          statistics.netMovement
        );

  const netLabel =
    document.createElement("span");

  netLabel.textContent =
    "Net movement";

  netRow.append(
    netValue,
    netLabel
  );

  container.append(netRow);

  const growthRow =
    document.createElement("div");

  growthRow.className =
    "movement-item movement-item--summary";

  growthRow.dataset.tone =
    statistics.growthPercentage < 0
      ? "negative"
      : statistics.growthPercentage > 0
        ? "positive"
        : "neutral";

  const growthValue =
    document.createElement("strong");

  const growth =
    Number(
      statistics.growthPercentage
    );

  growthValue.textContent =
    `${growth > 0 ? "+" : ""}` +
    `${formatNumber(growth, 2)}%`;

  const growthLabel =
    document.createElement("span");

  growthLabel.textContent =
    "Growth during the period";

  growthRow.append(
    growthValue,
    growthLabel
  );

  container.append(growthRow);
}

function renderMovementList(
  containerId,
  items
) {
  const container =
    document.getElementById(
      containerId
    );

  container.replaceChildren();

  items.forEach(item => {
    const row =
      document.createElement("div");

    row.className = "movement-item";
    row.dataset.tone = item.tone;

    const value =
      document.createElement("strong");

    value.textContent =
      formatNumber(item.value);

    row.append(
      value,
      document.createTextNode(
        item.label
      )
    );

    container.append(row);
  });
}

function renderGauges(gauges) {
  const grid =
    document.getElementById(
      "gauge-grid"
    );

  grid.replaceChildren();

  gauges.forEach(gauge => {
    const card =
      document.createElement("article");

    card.className =
      "gauge-card";

    const chart =
      document.createElement("div");

    chart.className =
      "chart";

    const title =
      document.createElement("h3");

    title.textContent =
      gauge.title;

    const performance =
      document.createElement("div");

    performance.className =
      "gauge-value";

    if (gauge.performanceText) {
      performance.textContent =
        gauge.performanceText;

      performance.dataset.tone =
        gauge.tone ?? "neutral";
    } else {
      performance.textContent =
        `${gauge.prefix}${formatNumber(
          gauge.value,
          gauge.decimalPlaces
        )}${gauge.suffix}`;
    }

    card.append(
      chart,
      title
    );

    const hasFinancialValues =
  gauge.actual !== null &&
  gauge.actual !== undefined &&
  gauge.budget !== null &&
  gauge.budget !== undefined;

if (hasFinancialValues) {
  const details =
    document.createElement("dl");

  details.className =
    "gauge-financial-details";

  [
    {
      label: "Actual",
      value: currency(gauge.actual)
    },
    {
      label: "Budget",
      value: currency(gauge.budget)
    }
  ].forEach(item => {
    const row =
      document.createElement("div");

    const term =
      document.createElement("dt");

    const value =
      document.createElement("dd");

    term.textContent =
      item.label;

    value.textContent =
      item.value;

    row.append(term, value);
      details.append(row);
    });

    const performanceRow =
      document.createElement("div");

    performanceRow.className =
      "gauge-financial-performance";

    const performanceTerm =
      document.createElement("dt");

    performanceTerm.textContent =
      "Performance";

    const performanceValue =
      document.createElement("dd");

    performanceValue.textContent =
      gauge.performanceText;

    performanceValue.dataset.tone =
      gauge.tone ?? "neutral";

    performanceRow.append(
      performanceTerm,
      performanceValue
    );

    details.append(performanceRow);
    card.append(details);
  } else {
    card.append(performance);
  }

    grid.append(card);

    drawGauge(chart, gauge);
  });
}

function waitForAnimationFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function canvasToPngBlob(canvas) {
  return new Promise(
    (resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error(
                "The report image could not be created."
              )
            );
          }
        },
        "image/png"
      );
    }
  );
}

function sanitiseFileName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function downloadReportImage() {
  const button =
    document.getElementById(
      "download-report-image"
    );

  const reportElement =
    document.querySelector(
      ".page-shell"
    );

  if (!button || !reportElement) {
    return;
  }

  if (
    typeof window.html2canvas !==
    "function"
  ) {
    window.alert(
      "The report-image library has not loaded."
    );

    return;
  }

  const originalText =
    button.textContent;

  button.disabled = true;
  button.textContent =
    "Preparing image…";

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await waitForAnimationFrame();

    const canvas =
      await window.html2canvas(
        reportElement,
        {
          backgroundColor:
            "#061a24",

          /*
           * Good quality without creating an
           * excessively large browser canvas.
           */
          scale: Math.min(
            window.devicePixelRatio || 1,
            1.5
          ),

          useCORS: true,
          allowTaint: false,
          logging: false,

          width:
            reportElement.scrollWidth,

          height:
            reportElement.scrollHeight,

          windowWidth:
            reportElement.scrollWidth,

          windowHeight:
            reportElement.scrollHeight,

          scrollX: 0,
          scrollY: 0,

          onclone:
            clonedDocument => {
              /*
               * Ensure charts which normally
               * animate as they enter the
               * viewport are captured in their
               * completed state.
               */
              clonedDocument
                .querySelectorAll(
                  ".chart-svg"
                )
                .forEach(svg => {
                  svg.classList.add(
                    "chart-svg--visible"
                  );
                });

              const captureStyles =
                clonedDocument
                  .createElement(
                    "style"
                  );

              captureStyles.textContent = `
                *,
                *::before,
                *::after {
                  animation: none !important;
                  transition: none !important;
                }

                .chart-svg,
                .chart-segment,
                .chart-segment-label,
                .chart-gauge-needle {
                  opacity: 1 !important;
                  transform: none !important;
                  clip-path: none !important;
                }
              `;

              clonedDocument.head.append(
                captureStyles
              );
            }
        }
      );

    const blob =
      await canvasToPngBlob(
        canvas
      );

    const objectUrl =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    const reportTitle =
      document
        .getElementById(
          "report-title"
        )
        ?.textContent;

    const fileName =
      sanitiseFileName(
        reportTitle
      ) || "kpi-report";

    link.href = objectUrl;
    link.download =
      `${fileName}.png`;

    document.body.append(link);

    link.click();
    link.remove();

    window.setTimeout(
      () => {
        URL.revokeObjectURL(
          objectUrl
        );
      },
      1000
    );
  } catch (error) {
    console.error(
      "Report image generation failed.",
      error
    );

    window.alert(
      "The report image could not be generated."
    );
  } finally {
    button.disabled = false;
    button.textContent =
      originalText;
  }
}

document
  .getElementById(
    "download-report-image"
  )
  ?.addEventListener(
    "click",
    downloadReportImage
  );
    
async function fetchReport() {
  const reportId =
    new URLSearchParams(
      window.location.search
    ).get("id");

  const url =
    reportId
      ? `/api/kpi-reports/${encodeURIComponent(
          reportId
        )}/rendered`
      : "/api/report";

  try {
    const response = await fetch(
      url,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `The report API returned ${response.status}.`
      );
    }

    const report =
      await response.json();

    const adminLink =
      document.querySelector(
        ".admin-link"
      );

    if (
      adminLink &&
      reportId
    ) {
      adminLink.href =
        `/admin/edit.html?id=${encodeURIComponent(
          reportId
        )}`;

      adminLink.textContent =
        "Edit report";
    }

    return report;
  } catch (apiError) {
    if (reportId) {
      throw apiError;
    }

    const fallback = await fetch(
      "/sample/kpi-report.json",
      {
        cache: "no-store"
      }
    );

    if (!fallback.ok) {
      throw apiError;
    }

    return await fallback.json();
  }
}

function renderReport(report) {
  document.title =
    report.header.title;

  setText(
    "financial-position-as-at",
    report.financialPositionAsAt
  );

  setText(
    "report-title",
    report.header.title
  );

  setText(
    "report-period",
    report.header.period
  );

  setText(
    "report-summary",
    report.header.summary
  );

  setText(
    "tee-period",
    report.teeTimeUtilisation.period
  );

  setText(
    "outgoings-title",
    report.outgoings.title
  );

  setText(
    "outgoings-description",
    report.outgoings.description
  );

  setText(
    "membership-description",
    report.membership.description
  );

  setText(
    "membership-trend-period",
    report.membershipTrend?.period
  );

  setText(
    "figures-date",
    report.figuresCorrectAsAt
  );

  setText(
    "feedback-heading",
    report.feedback.heading
  );

  setText(
    "feedback-text",
    report.feedback.text
  );

  const feedbackEmail =
    document.getElementById(
      "feedback-email"
    );

  feedbackEmail.textContent =
    report.feedback.emailAddress;

  feedbackEmail.href =
    `mailto:${report.feedback.emailAddress}`;

  document.getElementById(
    "feedback-qr"
  ).src =
    report.feedback.qrCodeImage;

  drawLineAreaChart(
    document.getElementById(
      "profit-chart"
    ),
    report.netProfit
  );

  renderFinancialTable(
    report.financialSummary
  );

  renderFinancialCommentary(
    report.financialCommentary
  );

  const outgoings =
  report.outgoings;

const hasCalculatedOutgoings =
  outgoings?.isCalculated === true &&
  Number.isFinite(
    Number(
      outgoings.totalOutgoings
    )
  ) &&
  Number(
    outgoings.totalOutgoings
  ) > 0 &&
  Number.isFinite(
    Number(
      outgoings.subscriptionIncome
    )
  );

  if (hasCalculatedOutgoings) {
    const totalOutgoings =
      Number(
        outgoings.totalOutgoings
      );

    const subscriptionIncome =
      Number(
        outgoings.subscriptionIncome
      );

    /*
    * Subscriptions cannot visually fund
    * more than 100% of expenditure.
    */
    const coverageRatio =
      Math.min(
        Math.max(
          subscriptionIncome /
          totalOutgoings,
          0
        ),
        1
      );

    const fundingGap =
      Math.max(
        totalOutgoings -
        subscriptionIncome,
        0
      );

    const categoryColours = [
      "#43afbf",
      "#a7d43e",
      "#f39a00",
      "#f3c600"
    ];

    /*
    * Each expenditure category is reduced
    * proportionally so that the four
    * categories together equal the amount
    * funded by subscription income.
    */
    const fundedExpenditureItems =
      outgoings.items.map(
        (item, index) => {
          const fullExpenditure =
            Math.max(
              Number(item.value) || 0,
              0
            );

          const fundedValue =
            fullExpenditure *
            coverageRatio;

          return {
            label: item.label,

            value: fundedValue,

            percentage:
              fundedValue /
              totalOutgoings *
              100,

            color:
              categoryColours[
                index %
                categoryColours.length
              ],

            exploded: false
          };
        }
      );

    /*
    * Put the deficit first so that it starts
    * at twelve o'clock and appears in the
    * upper-right of the chart.
    */
    const outgoingsChartItems = [];

    if (fundingGap > 0) {
      outgoingsChartItems.push({
        label: "Funding gap",

        value: fundingGap,

        percentage:
          fundingGap /
          totalOutgoings *
          100,

        color: "#e20d00",

        exploded: true
      });
    }

    outgoingsChartItems.push(
      ...fundedExpenditureItems
    );

    drawDonut(
    document.getElementById(
      "outgoings-chart"
    ),
    outgoingsChartItems,
    [],
    {
      width: 320,
      height: 320,
      cy: 160,

      outerRadius: 124,
      innerRadius: 58,

      startAngle: 0,
      segmentGap: 1.2,
      explodeOffset: 25,
      labelMinimumAngle: 12,

      labelFormatter:
        (item, percentage) =>
          `${formatNumber(
            percentage,
            1
          )}%`
    }
  );

    renderLegend(
      document.getElementById(
        "outgoings-legend"
      ),
      outgoingsChartItems,
      {
        valueFormatter:
          item =>
            `${formatNumber(
              item.percentage,
              1
            )}%`
      }
    );
  } else {
    /*
    * Legacy fallback for reports without
    * supporting financial data.
    */
    drawDonut(
      document.getElementById(
        "outgoings-chart"
      ),
      outgoings.items,
      [
        "Income",
        "allocation"
      ],
      {
        outerRadius: 110,
        innerRadius: 70
      }
    );

    renderLegend(
      document.getElementById(
        "outgoings-legend"
      ),
      outgoings.items
    );
  }

  renderOutgoingsSummary(
    outgoings
  );

  const playingTotal =
    sum(
      report.membership
        .playingMemberTypes
    );

  const allTotal =
    sum(
      report.membership
        .allMemberTypes
    );

  drawDonut(
    document.getElementById(
      "playing-members-chart"
    ),
    report.membership
      .playingMemberTypes,
    [
      "Playing",
      "Members",
      formatNumber(playingTotal)
    ],
    {
      width: 330,
      height: 300,
      outerRadius: 114,
      innerRadius: 70
    }
  );

  drawDonut(
    document.getElementById(
      "total-members-chart"
    ),
    report.membership
      .allMemberTypes,
    [
      "Total",
      "Members",
      formatNumber(allTotal)
    ],
    {
      width: 330,
      height: 300,
      outerRadius: 114,
      innerRadius: 70,
      labelSize: 11
    }
  );

  renderLegend(
    document.getElementById(
      "membership-legend"
    ),
    report.membership
      .allMemberTypes
  );

  drawStackedAreaChart(
    document.getElementById(
      "tee-chart"
    ),
    report.teeTimeUtilisation
  );

  renderTeeTable(
    report.teeTimeUtilisation
  );

  renderTeeLegend(
    report.teeTimeUtilisation
  );

  const membershipTrendSection =
    document.getElementById(
      "membership-trend-section"
    );

  const membershipTrendChart =
    document.getElementById(
      "membership-trend-chart"
    );

  const hasMembershipTrend =
    Array.isArray(
      report.membershipTrend?.dates
    ) &&
    report.membershipTrend.dates.length > 0;

  if (membershipTrendSection) {
    membershipTrendSection.hidden =
      !hasMembershipTrend;
  }

  if (
    hasMembershipTrend &&
    membershipTrendChart
  ) {
    drawMembershipTrendChart(
      membershipTrendChart,
      report.membershipTrend
    );
  }

  renderGauges(
    report.gauges
  );

  const membershipMovementSection =
    document.getElementById(
      "membership-movement-section"
    );

  const membershipMovementGrid =
    membershipMovementSection
      ?.querySelector(
        ".membership-movement-grid"
      );

  const membershipMovement =
    report.membershipMovement;

  const hasMembershipMovement =
    typeof membershipMovement?.period ===
      "string" &&
    membershipMovement.period
      .trim()
      .length > 0;

  const hasMembershipNarrative =
    typeof report.membershipNarrative ===
      "string" &&
    report.membershipNarrative
      .trim()
      .length > 0;

  if (membershipMovementSection) {
    membershipMovementSection.hidden =
      !hasMembershipMovement &&
      !hasMembershipNarrative;
  }

  if (membershipMovementGrid) {
    membershipMovementGrid.hidden =
      !hasMembershipMovement;
  }

  renderMembershipNarrative(
    report.membershipNarrative
  );

  if (hasMembershipMovement) {
    renderMembershipStatistics(
      "playing-membership-statistics",
      membershipMovement.playing
    );

    renderMembershipStatistics(
      "non-playing-membership-statistics",
      membershipMovement.nonPlaying
    );
  } else {
    renderMembershipStatistics(
      "playing-membership-statistics",
      null
    );

    renderMembershipStatistics(
      "non-playing-membership-statistics",
      null
    );
  }
}

function renderMembershipNarrative(value) {
  const container =
    document.getElementById(
      "membership-narrative"
    );

  if (!container) {
    return;
  }

  const narrative =
    String(value ?? "").trim();

  container.replaceChildren();
  container.hidden =
    narrative.length === 0;

  if (narrative.length === 0) {
    return;
  }

  const paragraph =
    document.createElement("p");

  paragraph.textContent =
    narrative;

  container.append(paragraph);
}

function renderFinancialCommentary(
  items
) {
  const container =
    document.getElementById(
      "financial-commentary"
    );

  const commentary =
    Array.isArray(items)
      ? items
          .map(
            item =>
              String(
                item ?? ""
              ).trim()
          )
          .filter(
            item =>
              item.length > 0
          )
      : [];

  container.replaceChildren();

  container.hidden =
    commentary.length === 0;

  if (commentary.length === 0) {
    return;
  }

  const columns =
    document.createElement("div");

  columns.className =
    "commentary-grid__columns";

  const leftColumn =
    document.createElement("div");

  leftColumn.className =
    "commentary-grid__column";

  const rightColumn =
    document.createElement("div");

  rightColumn.className =
    "commentary-grid__column";

  const splitIndex =
    Math.ceil(
      commentary.length / 2
    );

  appendFinancialCommentaryItems(
    leftColumn,
    commentary.slice(
      0,
      splitIndex
    )
  );

  appendFinancialCommentaryItems(
    rightColumn,
    commentary.slice(
      splitIndex
    )
  );

  columns.append(
    leftColumn,
    rightColumn
  );

  container.append(columns);
}

function appendFinancialCommentaryItems(
  column,
  items
) {
  items.forEach(item => {
    const paragraph =
      document.createElement("p");

    paragraph.textContent = item;

    column.append(paragraph);
  });
}

fetchReport()
  .then(renderReport)
  .catch(error => {
    const errorElement =
      document.getElementById(
        "load-error"
      );

    errorElement.hidden = false;

    errorElement.textContent =
      `The KPI report could not be loaded: ${error.message}`;
  });