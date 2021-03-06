import { parseState } from "@mapequation/infoparse";
import * as d3 from "d3";
import { forceRadial } from "./d3-force";
import fetchText from "./fetch-text";


const url = new URL(window.location.href);
const net = url.searchParams.get("net");
const filename = net || "example.net";

const nonEmptyLines = file => file.split("\n").filter(Boolean);

fetchText(filename)
  .then(net => draw(connectNetwork(parseState(nonEmptyLines(net)))));

function connectNetwork(network) {
  const nodesById = new Map(network.vertices.map(node => [node.id, {
    ...node,
    states: [],
  }]));

  const statesById = new Map(network.states.map(state => {
    const physicalNode = nodesById.get(state.physicalId);
    const stateNode = {
      ...state,
      node: physicalNode,
      links: [],
    };
    physicalNode.states.push(state);
    return [state.id, stateNode];
  }));

  const links = network.links.map(link => {
    const linkObject = {
      source: statesById.get(link.source),
      target: statesById.get(link.target),
      weight: link.weight,
    };
    linkObject.source.links.push(linkObject);
    return linkObject;
  });

  return {
    nodes: Array.from(nodesById.values()),
    states: Array.from(statesById.values()),
    links,
  };
}

function aggregatePhysLinks(stateLinks) {
  const physLinks = stateLinks.map(({ source, target, weight }) => ({
    source: source.node,
    target: target.node,
    weight,
  }));

  const linkSources = new Map();

  physLinks.forEach(link => {
    if (!linkSources.has(link.source)) {
      linkSources.set(link.source, new Map());
    }
    const targets = linkSources.get(link.source);
    const weight = targets.get(link.target) || 0;
    targets.set(link.target, weight + link.weight);
  });

  const aggregatedPhysLinks = [];

  for (let [source, targets] of linkSources) {
    for (let [target, weight] of targets) {
      aggregatedPhysLinks.push({ source, target, weight });
    }
  }

  return aggregatedPhysLinks;
}

function draw(net) {
  const { nodes, states, links } = net;
  const { innerWidth, innerHeight } = window;
  const nodeRadius = 50;
  const stateRadius = 15;

  const aggregatedPhysLinks = aggregatePhysLinks(links);

  const simulation = d3.forceSimulation(nodes)
    .force("center", d3.forceCenter(innerWidth / 2, innerHeight / 2))
    .force("collide", d3.forceCollide(2 * nodeRadius))
    .force("charge", d3.forceManyBody().strength(-1000))
    .force("link", d3.forceLink(aggregatedPhysLinks).distance(200));

  const stateSimulation = d3.forceSimulation(states)
    .force("center", d3.forceCenter(innerWidth / 2, innerHeight / 2))
    .force("collide", d3.forceCollide(stateRadius))
    .force("charge", d3.forceManyBody().strength(-200).distanceMax(2 * nodeRadius))
    .force("link", d3.forceLink(links).distance(d => d.source.node === d.target.node ? 2 * nodeRadius : 200))
    .force("radial", forceRadial(nodeRadius / 2, d => d.node.x, d => d.node.y).strength(0.8));

  const dragHelper = {
    start: d => {
      d.fx = d.x;
      d.fy = d.y;
    },
    drag: d => {
      d.fx += d3.event.dx;
      d.fy += d3.event.dy;
    },
    stop: d => {
      d.fx = null;
      d.fy = null;
    },
    setAlphaTarget: (alphaTarget = 0, stateAlphaTarget = 0) => {
      if (!d3.event.active) {
        simulation.alphaTarget(alphaTarget).restart();
        stateSimulation.alphaTarget(stateAlphaTarget).restart();
      }
    },
  };

  const defs = d3.select("#state-network").append("defs");

  defs.selectAll("marker")
    .data(["black", "red"])
    .enter()
    .append("marker")
    .attr("id", d => `arrow_${d}`)
    .attr("markerHeight", 5)
    .attr("markerWidth", 5)
    .attr("orient", "auto")
    .attr("refX", 3)
    .attr("viewBox", "-5 -5 10 10")
    .append("path")
    .attr("d", "M 0,0 m -5,-5 L 5,0 L -5,5 Z")
    .attr("fill", d => d);

  const zoom = d3.zoom().scaleExtent([0.1, 1000]);

  const svg = d3.select("#state-network")
    .call(zoom)
    .call(zoom.transform, d3.zoomIdentity);

  const zoomable = svg.append("g")
    .attr("id", "zoomable")
    .attr("transform", d3.zoomIdentity);

  zoom.on("zoom", () => zoomable.attr("transform", d3.event.transform));

  let node = zoomable.selectAll(".node").data(nodes);

  node.exit().remove();

  node = node.enter()
    .append("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", d => {
        dragHelper.setAlphaTarget(0.3, 0.8);
        dragHelper.start(d);
        d.states.forEach(dragHelper.start);
      })
      .on("drag", d => {
        dragHelper.drag(d);
        d.states.forEach(dragHelper.drag);
      })
      .on("end", d => {
        dragHelper.setAlphaTarget();
        dragHelper.stop(d);
        d.states.forEach(dragHelper.stop);
      }))
    .merge(node);

  node.append("circle")
    .attr("r", nodeRadius)
    .attr("fill", "#fafafa")
    .attr("stroke", "#888")
    .append("title")
    .text(d => d.name);

  node.append("text")
    .text(d => d.id)
    .attr("text-anchor", "middle")
    .attr("fill", "#999")
    .attr("dy", 12)
    .style("font-style", "italic")
    .style("font-size", 40);

  const maxLinkWeight = Math.max(...links.map(link => link.weight));

  const linkWidth = d3.scaleLinear().domain([0, maxLinkWeight]).range([0.1, 3]);

  let link = zoomable.selectAll(".link").data(links);

  link.exit().remove();

  link = link.enter()
    .append("line")
    .attr("class", "link")
    .attr("opacity", 1)
    .attr("stroke", "#000")
    .attr("stroke-width", d => linkWidth(d.weight))
    .attr("marker-end", "url(#arrow_black)")
    .merge(link);

  let state = zoomable.selectAll(".state").data(states);

  state.exit().remove();

  const setColor = color => function (d) {
    const circle = d3.select(this).select("circle");
    if (circle.attr("stroke") === color) return;
    circle.attr("stroke", color);
    const targetNodes = new Set();
    link
      .filter(link => link.source === d)
      .attr("stroke", color)
      .attr("marker-end", `url(#arrow_${color})`)
      .each(link => targetNodes.add(link.target));
    state
      .select(function (d) { return targetNodes.has(d) ? this : null; })
      .each(setColor(color));
  };

  state = state.enter()
    .append("g")
    .attr("class", "state")
    .on("mouseover", setColor("red"))
    .on("mouseout", setColor("black"))
    .call(d3.drag()
      .on("start", d => {
        dragHelper.setAlphaTarget(0.01, 0.5);
        dragHelper.start(d);
      })
      .on("drag", dragHelper.drag)
      .on("end", d => {
        dragHelper.setAlphaTarget();
        dragHelper.stop(d);
      }))
    .merge(state);

  state.append("circle")
    .attr("r", stateRadius)
    .attr("fill", "#fff")
    .attr("stroke", "#000")
    .attr("opacity", 0.9)
    .append("title")
    .text(d => d.name);

  state.append("text")
    .text(d => d.id)
    .attr("text-anchor", "middle")
    .attr("dy", 5)
    .style("font-style", "italic")
    .style("font-size", 15);

  const drawLink = r => function (d) {
    const x1 = d.source.x || 0;
    const y1 = d.source.y || 0;
    const x2 = d.target.x || 0;
    const y2 = d.target.y || 0;
    const dx = x2 - x1 || 1e-6;
    const dy = y2 - y1 || 1e-6;
    const l = Math.sqrt(dx * dx + dy * dy);
    const dir = { x: dx / l, y: dy / l };

    d3.select(this)
      .attr("x1", x1 + r * dir.x)
      .attr("y1", y1 + r * dir.y)
      .attr("x2", x2 - r * dir.x)
      .attr("y2", y2 - r * dir.y);
  };

  simulation.on("tick", () => {
    link
      .each(drawLink(stateRadius));

    state.select("circle")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    state.select("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y);

    node.select("circle")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    node.select("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y);
  });
}
