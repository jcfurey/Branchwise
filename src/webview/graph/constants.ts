/* The graph's geometry across its lanes, in CSS pixels. Rows follow `ROW_HEIGHT`. */

/** From one lane's centre to the next. */
export const LANE_WIDTH = 16;

/** From the drawing's left edge to lane 0's centre; the same margin follows the last lane. */
export const LANE_OFFSET = 8;

/** The radius of every commit dot. Scrolling a dot into view keeps 4 pixels more than this. */
export const VERTEX_RADIUS = 4;

/** Room added after the drawing when the graph column is sized. */
export const GRAPH_PADDING = 16;
