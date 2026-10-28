/**
 * IdeaProbe — Falsifiable Experiment Decision Engine (Slice 2C / 2C.1)
 *
 * Deterministic evidence-based evaluation comparing recorded experiment results
 * against predefined falsifiable thresholds and decision rules.
 *
 * Rules:
 * 1. Pure deterministic logic — zero AI hallucinations or speculative leaps.
 * 2. Supported: observed result meets the predefined success criterion.
 * 3. Rejected: observed result meets the predefined failure criterion.
 * 4. Inconclusive: missing result, qualitative/ambiguous result, between thresholds (pivot zone),
 *    incompatible units, or unparsable threshold definition.
 * 5. Respects metric directionality (e.g. CAC / churn / error rate are lower-is-better).
 * 6. Explicit threshold operators are never overridden by keyword heuristics.
 * 7. Explicitly distinguishes observed evidence from AI inferences or assumptions.
 */

export type DecisionOutcome = "supported" | "rejected" | "inconclusive";

export interface ThresholdCriteria {
  raw: string;
  targetValue: number | null;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better";
  operator: ">=" | ">" | "<=" | "<" | "==";
  failureValue?: number | null;
  failureOperator?: "<" | "<=" | ">" | ">=";
  pivotRange?: [number, number] | null;
}

export interface ObservedMeasurement {
  rawValue: string;
  numericValue: number | null;
  unit: string | null;
  extractedContext: string | null;
}

export interface ExperimentDecision {
  outcome: DecisionOutcome;
  label: "Supported" | "Rejected" | "Inconclusive";
  headline: string;
  explanation: string;
  thresholdCriteria: ThresholdCriteria | null;
  observedMeasurement: ObservedMeasurement;
  isQuantitative: boolean;
  suggestedAssumptionStatus: "validated" | "invalidated" | "keep";
}

// Keywords indicating lower-is-better metrics (costs, error rates, churn, latency)
const LOWER_IS_BETTER_KEYWORDS = [
  "cost",
  "cac",
  "churn",
  "drop-off",
  "dropoff",
  "bounce",
  "error",
  "latency",
  "abandonment",
  "cancellation",
  "unsubscribe",
  "unsub",
  "time to",
  "complaint",
  "defect",
  "spend",
  "loss",
  "friction",
];

/**
 * Helper to test numeric values against comparison operators.
 */
export function testOperator(
  val: number,
  op: ">=" | ">" | "<=" | "<" | "==",
  target: number
): boolean {
  switch (op) {
    case ">=":
      return val >= target;
    case ">":
      return val > target;
    case "<=":
      return val <= target;
    case "<":
      return val < target;
    case "==":
      return Math.abs(val - target) < 1e-9;
  }
}

/**
 * Parses a threshold string, metric, and optional decision rules into structured criteria.
 */
export function parseThresholdCriteria(
  thresholdStr?: string | null,
  metricStr?: string | null,
  decisionRulesStr?: string | null
): ThresholdCriteria | null {
  if (!thresholdStr || !thresholdStr.trim()) return null;
  const raw = thresholdStr.trim();

  // 1. Detect explicit operator
  let explicitOperator: ">=" | ">" | "<=" | "<" | "==" | null = null;
  if (/^(>=|≥)/.test(raw) || /\b(>=|≥)\b/.test(raw) || />=/.test(raw) || /≥/.test(raw)) {
    explicitOperator = ">=";
  } else if (/^(<=|≤)/.test(raw) || /\b(<=|≤)\b/.test(raw) || /<=/.test(raw) || /≤/.test(raw)) {
    explicitOperator = "<=";
  } else if (/^(==|=)/.test(raw) || /\b==\b/.test(raw)) {
    explicitOperator = "==";
  } else if (/^>/.test(raw) || /\b>\b/.test(raw)) {
    explicitOperator = ">";
  } else if (/^</.test(raw) || /\b<\b/.test(raw)) {
    explicitOperator = "<";
  }

  // 2. Detect directionality & assign operator
  let direction: "higher_is_better" | "lower_is_better" = "higher_is_better";
  let operator: ">=" | ">" | "<=" | "<" | "==" = ">=";

  if (explicitOperator) {
    operator = explicitOperator;
    if (explicitOperator === "<=" || explicitOperator === "<") {
      direction = "lower_is_better";
    } else {
      direction = "higher_is_better";
    }
  } else {
    // No explicit operator: check lower-is-better keywords in metric/threshold text
    const textToCheck = `${metricStr || ""} ${raw}`.toLowerCase();
    const isLower = LOWER_IS_BETTER_KEYWORDS.some((kw) => textToCheck.includes(kw));
    if (isLower) {
      direction = "lower_is_better";
      operator = "<=";
    } else {
      direction = "higher_is_better";
      operator = ">=";
    }
  }

  // 3. Extract numeric target value and unit
  let targetValue: number | null = null;
  let unit: string | null = null;

  // Check percentage: e.g. ">= 40%" or "≥ 30% adherence"
  const pctMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    targetValue = parseFloat(pctMatch[1]);
    unit = "%";
  } else {
    // Check currency: e.g. "<= $10" or "₹99"
    const currMatch = raw.match(/([$₹€£])\s*(\d+(?:\.\d+)?)/) || raw.match(/(\d+(?:\.\d+)?)\s*([$₹€£])/);
    if (currMatch) {
      const sym = currMatch[1].length === 1 && !isNaN(Number(currMatch[1])) ? currMatch[2] : currMatch[1];
      const val = currMatch[1].length === 1 && !isNaN(Number(currMatch[1])) ? currMatch[1] : currMatch[2];
      targetValue = parseFloat(val);
      unit = sym;
    } else {
      // General number
      const numMatch = raw.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        targetValue = parseFloat(numMatch[1]);
        // Extract trailing word as unit if available
        const afterNum = raw.slice(numMatch.index! + numMatch[0].length).trim();
        const wordMatch = afterNum.match(/^([a-zA-Z]+)/);
        if (wordMatch) {
          unit = wordMatch[1];
        }
      }
    }
  }

  if (targetValue === null || isNaN(targetValue)) {
    return null;
  }

  // 4. Parse Decision Rules for Stop (Failure) and Pivot (Inconclusive) boundaries
  let failureValue: number | null = null;
  let failureOperator: "<" | "<=" | ">" | ">=" | undefined = undefined;
  let pivotRange: [number, number] | null = null;

  if (decisionRulesStr && decisionRulesStr.trim()) {
    try {
      let pivotText = "";
      let stopText = "";

      if (decisionRulesStr.trim().startsWith("{")) {
        const rulesObj = JSON.parse(decisionRulesStr);
        pivotText = rulesObj.pivot || "";
        stopText = rulesObj.stop || "";
      } else {
        // Plain text rules e.g. "Continue: observed result >= 40%. Pivot: observed result from 20% through 39%, inclusive. Stop: observed result < 20%."
        const pivMatch =
          decisionRulesStr.match(/pivot(?:\s*if|\s*when|\s*zone|\s*range)?\s*[:\-\u2192]?\s*([^.;]+)/i) ||
          decisionRulesStr.match(/([^.;\n]+\bpivot\b[^.;\n]*)/i);
        if (pivMatch) pivotText = pivMatch[1] || pivMatch[0];

        const stMatch =
          decisionRulesStr.match(/stop(?:\s*if|\s*when|\s*condition)?\s*[:\-\u2192]?\s*([^.;]+)/i) ||
          decisionRulesStr.match(/([^.;\n]+\bstop\b[^.;\n]*)/i);
        if (stMatch) stopText = stMatch[1] || stMatch[0];

        if (!pivotText && /pivot/i.test(decisionRulesStr)) {
          pivotText = decisionRulesStr;
        }
        if (!stopText && /stop/i.test(decisionRulesStr)) {
          stopText = decisionRulesStr;
        }
      }

      // Parse stop rule for failure value & operator
      if (stopText) {
        if (/<=|≤/.test(stopText)) {
          const m = stopText.match(/(?:<=|≤)\s*(\d+(?:\.\d+)?)/);
          if (m) {
            failureValue = parseFloat(m[1]);
            failureOperator = "<=";
          }
        } else if (/<\s*(\d+(?:\.\d+)?)/.test(stopText)) {
          const m = stopText.match(/<\s*(\d+(?:\.\d+)?)/);
          if (m) {
            failureValue = parseFloat(m[1]);
            failureOperator = "<";
          }
        } else if (/>=|≥/.test(stopText)) {
          const m = stopText.match(/(?:>=|≥)\s*(\d+(?:\.\d+)?)/);
          if (m) {
            failureValue = parseFloat(m[1]);
            failureOperator = ">=";
          }
        } else if (/>\s*(\d+(?:\.\d+)?)/.test(stopText)) {
          const m = stopText.match(/>\s*(\d+(?:\.\d+)?)/);
          if (m) {
            failureValue = parseFloat(m[1]);
            failureOperator = ">";
          }
        }
      }

      // Parse pivot rule for range (e.g. "from 20% through 39%", "20-39%", "between 20% and 39%", "$10 to $15")
      if (pivotText) {
        const rangeMatch = pivotText.match(
          /[$₹€£]?\s*(\d+(?:\.\d+)?)\s*%?\s*(?:-|to|through|and)\s*[$₹€£]?\s*(\d+(?:\.\d+)?)\s*%?/i
        );
        if (rangeMatch) {
          const low = parseFloat(rangeMatch[1]);
          const high = parseFloat(rangeMatch[2]);
          if (!isNaN(low) && !isNaN(high) && low < high) {
            pivotRange = [low, high];
          }
        }
      }
    } catch {
      // Non-fatal parse failure
    }
  }

  return {
    raw,
    targetValue,
    unit,
    direction,
    operator,
    failureValue,
    failureOperator,
    pivotRange,
  };
}

/**
 * Extracts the quantitative observed measurement from a founder's experiment result text.
 */
export function extractObservedMeasurement(
  resultText?: string | null,
  targetUnit?: string | null
): ObservedMeasurement {
  if (!resultText || !resultText.trim()) {
    return {
      rawValue: "",
      numericValue: null,
      unit: null,
      extractedContext: null,
    };
  }

  const text = resultText.trim();

  // 1. If looking for a percentage
  if (targetUnit === "%") {
    // Mask out mentions of "vs X% threshold" or "target X%" so we don't extract the benchmark
    const sanitized = text.replace(/vs\.?\s*(\d+(?:\.\d+)?)\s*%\s*(?:threshold|target|goal)?/gi, "__BENCHMARK__");

    // Match all percentages
    const pctMatches = [...sanitized.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
    if (pctMatches.length > 0) {
      if (pctMatches.length === 1) {
        const val = parseFloat(pctMatches[0][1]);
        return {
          rawValue: text,
          numericValue: val,
          unit: "%",
          extractedContext: `${val}%`,
        };
      }
      // If multiple percentages exist, prioritize the one annotated with outcome/rate/adherence/conversion
      let chosen = pctMatches[0];
      for (const m of pctMatches) {
        const fullMatchIdx = m.index ?? 0;
        const surrounding = text
          .slice(Math.max(0, fullMatchIdx - 20), Math.min(text.length, fullMatchIdx + 30))
          .toLowerCase();
        if (
          surrounding.includes("result") ||
          surrounding.includes("rate") ||
          surrounding.includes("conversion") ||
          surrounding.includes("adherence")
        ) {
          chosen = m;
          break;
        }
      }
      const val = parseFloat(chosen[1]);
      return {
        rawValue: text,
        numericValue: val,
        unit: "%",
        extractedContext: `${val}%`,
      };
    }

    // Look for fraction/ratio like "18 completed out of 25 (72%)" or "18/25"
    const ratioMatch = text.match(/(\d+)\s*(?:out of|\/)\s*(\d+)/i);
    if (ratioMatch) {
      const num = parseFloat(ratioMatch[1]);
      const den = parseFloat(ratioMatch[2]);
      if (den > 0) {
        const calcPct = Math.round((num / den) * 1000) / 10;
        return {
          rawValue: text,
          numericValue: calcPct,
          unit: "%",
          extractedContext: `${num}/${den} (${calcPct}%)`,
        };
      }
    }

    // Percentage requested, but text has NO percentage and NO ratio!
    // Incompatible units (e.g. text only had "$500" or "5 interviews") -> null
    return {
      rawValue: text,
      numericValue: null,
      unit: null,
      extractedContext: null,
    };
  }

  // 2. If looking for currency
  if (targetUnit === "$" || targetUnit === "₹" || targetUnit === "€" || targetUnit === "£") {
    const targetSym = targetUnit;
    const searchSymPattern = `\\${targetSym}`;

    const unitEconRegex = new RegExp(`(${searchSymPattern})\\s*(\\d+(?:\\.\\d+)?)\\s*(?:cac|per|each)?`, "gi");
    const matches = [...text.matchAll(unitEconRegex)];

    if (matches.length > 0) {
      if (matches.length === 1) {
        const sym = matches[0][1];
        const val = parseFloat(matches[0][2]);
        return {
          rawValue: text,
          numericValue: val,
          unit: sym,
          extractedContext: `${sym}${val}`,
        };
      }
      // If multiple currency values exist, prioritize unit economics keyword (CAC, per user) over total spend
      let chosen: RegExpMatchArray | null = null;
      for (const m of matches) {
        const fullMatchIdx = m.index ?? 0;
        const surrounding = text
          .slice(Math.max(0, fullMatchIdx - 15), Math.min(text.length, fullMatchIdx + 25))
          .toLowerCase();
        if ((surrounding.includes("cac") || surrounding.includes("per")) && !surrounding.includes("spend")) {
          chosen = m;
          break;
        }
      }
      // If none has distinct unit economics keywords and multiple exist, it is ambiguous
      if (!chosen) {
        return {
          rawValue: text,
          numericValue: null,
          unit: null,
          extractedContext: null,
        };
      }
      const sym = chosen[1];
      const val = parseFloat(chosen[2]);
      return {
        rawValue: text,
        numericValue: val,
        unit: sym,
        extractedContext: `${sym}${val}`,
      };
    }

    // Currency requested, but no currency in text -> Incompatible units -> null
    return {
      rawValue: text,
      numericValue: null,
      unit: null,
      extractedContext: null,
    };
  }

  // 3. If targetUnit is a count or specific word
  if (targetUnit && targetUnit !== "%" && !/[$₹€£]/.test(targetUnit)) {
    // If text ONLY has percentage or currency, it's incompatible with a count
    if (/^\s*[$₹€£]\s*\d+/.test(text) || /^\s*\d+\s*%\s*$/.test(text)) {
      return {
        rawValue: text,
        numericValue: null,
        unit: null,
        extractedContext: null,
      };
    }
  }

  // Plain number match if text is just a number (e.g. "56" or "56.5")
  const trimmed = text.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const val = parseFloat(trimmed);
    return {
      rawValue: text,
      numericValue: val,
      unit: targetUnit || null,
      extractedContext: `${val}${targetUnit || ""}`,
    };
  }

  // Look for any standalone number in context
  const numMatches = [...text.matchAll(/(\d+(?:\.\d+)?)/g)];
  if (numMatches.length === 1) {
    const val = parseFloat(numMatches[0][1]);
    return {
      rawValue: text,
      numericValue: val,
      unit: targetUnit || null,
      extractedContext: `${val}${targetUnit || ""}`,
    };
  } else if (numMatches.length > 1) {
    // Multiple numbers without clear target unit or context -> ambiguous -> return null
    return {
      rawValue: text,
      numericValue: null,
      unit: null,
      extractedContext: null,
    };
  }

  // Qualitative or non-numeric observation
  return {
    rawValue: text,
    numericValue: null,
    unit: null,
    extractedContext: null,
  };
}

/**
 * Compares an experiment's recorded result with its threshold using explicit, deterministic logic.
 */
export function evaluateExperimentDecision(
  experiment: {
    metric?: string;
    threshold?: string;
    decision_rules?: string | null;
    decisionRules?: string | null;
    result?: string | null;
    hypothesis?: string;
  },
  overrideResultText?: string
): ExperimentDecision {
  const resultToEvaluate = overrideResultText !== undefined ? overrideResultText : (experiment.result || null);
  const rawRules = experiment.decision_rules || (experiment as any).decisionRules;
  const thresholdCriteria = parseThresholdCriteria(
    experiment.threshold,
    experiment.metric,
    rawRules
  );

  // 1. Missing or empty result
  if (!resultToEvaluate || !resultToEvaluate.trim()) {
    return {
      outcome: "inconclusive",
      label: "Inconclusive",
      headline: "No Execution Observation Recorded",
      explanation:
        "No experiment execution observations have been recorded yet. Conduct the experiment and record quantitative data to evaluate the hypothesis.",
      thresholdCriteria,
      observedMeasurement: { rawValue: "", numericValue: null, unit: null, extractedContext: null },
      isQuantitative: false,
      suggestedAssumptionStatus: "keep",
    };
  }

  // 2. Unparsable or missing threshold
  if (!thresholdCriteria || thresholdCriteria.targetValue === null) {
    return {
      outcome: "inconclusive",
      label: "Inconclusive",
      headline: "Ambiguous Predefined Threshold",
      explanation: `The predefined threshold ('${experiment.threshold || "Not specified"}') does not define an unambiguous quantitative target. Update the experiment threshold to enable deterministic comparison.`,
      thresholdCriteria: null,
      observedMeasurement: extractObservedMeasurement(resultToEvaluate, null),
      isQuantitative: false,
      suggestedAssumptionStatus: "keep",
    };
  }

  // 3. Extract observed measurement matching threshold unit
  const measurement = extractObservedMeasurement(resultToEvaluate, thresholdCriteria.unit);

  if (measurement.numericValue === null) {
    return {
      outcome: "inconclusive",
      label: "Inconclusive",
      headline: "Insufficient Quantitative Measurement",
      explanation: `The recorded result is qualitative or lacks a discernible numeric measurement matching the threshold target ('${thresholdCriteria.raw}'). Record quantitative metrics (e.g. percentages or counts) to determine whether the hypothesis is supported or rejected.`,
      thresholdCriteria,
      observedMeasurement: measurement,
      isQuantitative: false,
      suggestedAssumptionStatus: "keep",
    };
  }

  const observed = measurement.numericValue;
  const target = thresholdCriteria.targetValue;
  const unitStr = thresholdCriteria.unit || "";

  // 4. Test Success Criterion
  const meetsSuccess = testOperator(observed, thresholdCriteria.operator, target);

  if (meetsSuccess) {
    const isLower = thresholdCriteria.direction === "lower_is_better";
    return {
      outcome: "supported",
      label: "Supported",
      headline: "Hypothesis Supported by Observed Evidence",
      explanation: isLower
        ? `Observed result of ${observed}${unitStr} satisfies the lower-is-better criterion of ${thresholdCriteria.raw} (observed value is at or below target). Recorded evidence supports the hypothesis.`
        : `Observed result of ${observed}${unitStr} meets or exceeds the predefined success criterion of ${thresholdCriteria.raw}. Recorded data supports the falsifiable hypothesis.`,
      thresholdCriteria,
      observedMeasurement: measurement,
      isQuantitative: true,
      suggestedAssumptionStatus: "validated",
    };
  }

  // 5. Test Explicit Pivot Range (evaluated BEFORE generic below-success rejection)
  if (thresholdCriteria.pivotRange) {
    const [pLow, pHigh] = thresholdCriteria.pivotRange;
    if (observed >= pLow && observed <= pHigh) {
      return {
        outcome: "inconclusive",
        label: "Inconclusive",
        headline: "Pivot Signal — Between Thresholds",
        explanation: `Observed result of ${observed}${unitStr} falls into the predefined pivot range (${pLow}–${pHigh}${unitStr}), between failure and full success criteria. Evidence suggests customer interest with specific friction, requiring iteration rather than immediate validation or rejection.`,
        thresholdCriteria,
        observedMeasurement: measurement,
        isQuantitative: true,
        suggestedAssumptionStatus: "keep",
      };
    }
  }

  // 6. Test Explicit Stop / Failure Criterion or Generic Failure
  let isExplicitStop = false;
  if (
    thresholdCriteria.failureValue !== null &&
    thresholdCriteria.failureValue !== undefined &&
    thresholdCriteria.failureOperator
  ) {
    isExplicitStop = testOperator(
      observed,
      thresholdCriteria.failureOperator as any,
      thresholdCriteria.failureValue
    );
  }

  const stopVal = thresholdCriteria.failureValue;
  const stopOp = thresholdCriteria.failureOperator || (thresholdCriteria.direction === "lower_is_better" ? ">" : "<");

  return {
    outcome: "rejected",
    label: "Rejected",
    headline: "Hypothesis Rejected by Observed Evidence",
    explanation: isExplicitStop
      ? `Observed result of ${observed}${unitStr} meets the predefined failure stop rule (${stopOp} ${stopVal}${unitStr}) and falls far short of the success threshold (${thresholdCriteria.raw}). Evidence disproves the core hypothesis.`
      : `Observed result of ${observed}${unitStr} fails to reach the required success threshold of ${thresholdCriteria.raw}. The hypothesis is rejected by recorded experimental data.`,
    thresholdCriteria,
    observedMeasurement: measurement,
    isQuantitative: true,
    suggestedAssumptionStatus: "invalidated",
  };
}

/**
 * UI Badging & Color Tokens for Decision Outcomes
 */
export const DECISION_CONFIG: Record<
  DecisionOutcome,
  {
    label: string;
    badgeClass: string;
    bgClass: string;
    borderClass: string;
    textClass: string;
    icon: string;
  }
> = {
  supported: {
    label: "Supported",
    badgeClass: "badge-success",
    bgClass: "var(--badge-success-bg, rgba(16, 185, 129, 0.12))",
    borderClass: "var(--color-success, #10b981)",
    textClass: "var(--color-success, #10b981)",
    icon: "✓",
  },
  rejected: {
    label: "Rejected",
    badgeClass: "badge-danger",
    bgClass: "var(--badge-danger-bg, rgba(239, 68, 68, 0.12))",
    borderClass: "var(--color-danger, #ef4444)",
    textClass: "var(--color-danger, #ef4444)",
    icon: "✗",
  },
  inconclusive: {
    label: "Inconclusive",
    badgeClass: "badge-neutral",
    bgClass: "var(--badge-neutral-bg, rgba(245, 158, 11, 0.12))",
    borderClass: "var(--color-warning, #f59e0b)",
    textClass: "var(--color-warning, #f59e0b)",
    icon: "?",
  },
};
