/**
 * Risk-score colouring and Fisher-Jenks classification.
 * Ports risk_score_to_color and classify_risk_scores from eikon_demo_app_beta.py.
 */
import { ckmeans } from "simple-statistics";

export type RGBA = [number, number, number, number];

/** Map a risk score to a blue→red RGBA colour. Ports risk_score_to_color. */
export function riskScoreToColor(score: number, maxScore = 1.0): RGBA {
  const t = maxScore > 0 ? Math.min(score / maxScore, 1.0) : 0;
  const r = Math.trunc(59 + (180 - 59) * t);
  const g = Math.trunc(76 + (4 - 76) * t);
  const b = Math.trunc(192 + (38 - 192) * t);
  return [r, g, b, 255];
}

export interface Classification {
  classLabels: number[];
  binEdges: number[];
  kActual: number;
  classColors: RGBA[];
}

/**
 * Classify risk scores into discrete bins with natural breaks.
 * Ports classify_risk_scores. mapclassify.NaturalBreaks computes an optimal
 * Fisher-Jenks partition; ckmeans (Ckmeans.1d.dp) is the provably-optimal 1D
 * clustering with the same within-class variance objective, so its breaks
 * match for a given k. Edge cases (≤1 unique value) replicate the Python.
 */
export function classifyRiskScores(scores: number[], k = 5): Classification {
  const values = scores.map(Number);
  const unique = Array.from(new Set(values));
  const maxVal = Math.max(...values);

  if (unique.length <= 1) {
    const safeMax = Math.max(maxVal, 0.01);
    return {
      classLabels: values.map(() => 0),
      binEdges: [maxVal],
      kActual: 1,
      classColors: [riskScoreToColor(maxVal, safeMax)],
    };
  }

  const kUse = Math.min(k, unique.length);
  const clusters = ckmeans(values, kUse); // sorted ascending groups
  const kActual = clusters.length;

  // Upper boundary of each class (the cluster maxima), ascending.
  const binEdges = clusters.map((c) => c[c.length - 1]);

  // Assign each value to the class whose upper edge first contains it.
  const classLabels = values.map((v) => {
    for (let i = 0; i < binEdges.length; i++) {
      if (v <= binEdges[i]) return i;
    }
    return binEdges.length - 1;
  });

  const safeMax = Math.max(maxVal, 0.01);
  const classColors: RGBA[] = [];
  for (let i = 0; i < kActual; i++) {
    const t = kActual > 1 ? i / (kActual - 1) : 0;
    classColors.push(riskScoreToColor(t * safeMax, safeMax));
  }

  return { classLabels, binEdges, kActual, classColors };
}
