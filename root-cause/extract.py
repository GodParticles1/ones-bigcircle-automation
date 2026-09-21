#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = "bigcircle.root-cause-extraction/v1alpha1"
SOURCE_SCHEMA = "bigcircle.confirmed-case-export/v1alpha1"
ALLOWED_STATES = {"CONFIRMED", "PROVISIONAL", "ABSENT", "CONFLICT"}

ROOT_LABELS = (
    "最终根因",
    "故障根因",
    "根本原因",
    "根因",
    "最终原因",
    "故障原因",
)
GENERIC_CAUSE_LABELS = ("原因",)

SECTION_LABELS = ROOT_LABELS + GENERIC_CAUSE_LABELS + (
    "现象",
    "处理",
    "已处理",
    "结果",
    "解决方案",
    "解决办法",
    "下一步",
    "任务",
    "备注",
    "结论",
)
SECTION_RE = re.compile(
    r"(?P<label>"
    + "|".join(re.escape(x) for x in sorted(SECTION_LABELS, key=len, reverse=True))
    + r")\s*[：:]"
)

PROVISIONAL_CUES = (
    "可能",
    "怀疑",
    "疑似",
    "初步判断",
    "当前判断",
    "暂时无法",
    "暂无法",
    "待确认",
    "需要确认",
    "需确认",
    "未确认",
    "不能确定",
    "无法确定",
    "有可能",
    "推测",
    "待核实",
    "待验证",
    "进一步验证",
    "进一步核实",
    "看着",
    "估计",
    "大概率",
    "不清楚",
    "未知",
    "无法进一步确定",
    "尚未确定",
)

PROVISIONAL_SECTION_RE = re.compile(
    r"(?P<label>初步判断|当前判断|初步原因|疑似原因)\s*[：:]\s*"
    r"(?P<text>[^；;\n。]+)"
)

STRONG_CAUSE_PATTERNS = (
    (
        "FINAL_CAUSAL_WORDING",
        re.compile(
            r"(?:最终定位(?:为|到)|最终确认(?:为|是)|确认由于|本质是|"
            r"原因是|原因为|定位为|定位到|定位是(?!否))\s*"
            r"(?P<text>[^；;\n。]+)"
        ),
    ),
)


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "").strip().strip("；;。 "))


def normalize_claim(value):
    return re.sub(r"[\s，,；;。.!！?？、:：]+", "", clean_text(value)).casefold()


def uncertainty_cues(value):
    text = str(value or "")
    found = {cue for cue in PROVISIONAL_CUES if cue in text}
    for name, pattern in UNCERTAINTY_PATTERNS:
        if pattern.search(text):
            found.add(name)
    return sorted(found)


def extract_sections(remarks):
    text = str(remarks or "")
    matches = list(SECTION_RE.finditer(text))
    sections = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        value = clean_text(text[match.end():end])
        if value:
            sections.append({"label": match.group("label"), "text": value})
    return sections


def unique_claims(values):
    seen = set()
    result = []
    for value in values:
        value = clean_text(value)
        key = normalize_claim(value)
        if value and key and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def make_summary(rule, cues=None, claim_count=0):
    parts = [f"rule={rule}"]
    if claim_count:
        parts.append(f"claims={claim_count}")
    if cues:
        parts.append("uncertainty=" + ",".join(sorted(set(cues))))
    return "; ".join(parts)


def classify_remarks(remarks):
    if not isinstance(remarks, str):
        raise ValueError("remarks must be a string")

    sections = extract_sections(remarks)
    root_claims = unique_claims(
        row["text"] for row in sections if row["label"] in ROOT_LABELS
    )
    generic_claims = unique_claims(
        row["text"] for row in sections if row["label"] in GENERIC_CAUSE_LABELS
    )

    selected = root_claims if root_claims else generic_claims
    rule = "ROOT_LABEL" if root_claims else ("CAUSE_LABEL" if generic_claims else None)

    if not selected:
        for pattern_name, pattern in STRONG_CAUSE_PATTERNS:
            match = pattern.search(remarks)
            if match:
                selected = unique_claims([match.group("text")])
                rule = pattern_name
                break

    if selected:
        cues = sorted({cue for claim in selected for cue in uncertainty_cues(claim)})
        if len(selected) > 1:
            return {
                "rootCauseText": None,
                "rootCauseState": "CONFLICT",
                "rootCauseEvidenceSummary": make_summary(rule, cues, len(selected)),
                "rootCauseSource": "remarks",
            }
        if cues:
            return {
                "rootCauseText": selected[0],
                "rootCauseState": "PROVISIONAL",
                "rootCauseEvidenceSummary": make_summary(rule, cues, 1),
                "rootCauseSource": "remarks",
            }
        return {
            "rootCauseText": selected[0],
            "rootCauseState": "CONFIRMED",
            "rootCauseEvidenceSummary": make_summary(rule, None, 1),
            "rootCauseSource": "remarks",
        }

    provisional_section = PROVISIONAL_SECTION_RE.search(remarks)
    if provisional_section:
        claim = clean_text(provisional_section.group("text"))
        cues = uncertainty_cues(claim) or [provisional_section.group("label")]
        return {
            "rootCauseText": claim or None,
            "rootCauseState": "PROVISIONAL",
            "rootCauseEvidenceSummary": make_summary("PROVISIONAL_SECTION", cues, 1 if claim else 0),
            "rootCauseSource": "remarks",
        }

    all_cues = uncertainty_cues(remarks)
    causal_context = bool(
        re.search(r"(根因|原因|判断|定位|触发原因|底层触发|待确认)", remarks)
    )
    if causal_context and all_cues:
        return {
            "rootCauseText": None,
            "rootCauseState": "PROVISIONAL",
            "rootCauseEvidenceSummary": make_summary("UNRESOLVED_CAUSE", all_cues, 0),
            "rootCauseSource": "remarks",
        }

    return {
        "rootCauseText": None,
        "rootCauseState": "ABSENT",
        "rootCauseEvidenceSummary": make_summary("NO_EXPLICIT_CAUSE", None, 0),
        "rootCauseSource": "remarks",
    }


def validate_feed(doc):
    if not isinstance(doc, dict):
        raise ValueError("feed must be a JSON object")
    if doc.get("schema") != SOURCE_SCHEMA:
        raise ValueError(f"schema must be {SOURCE_SCHEMA}")
    if doc.get("complete") is not True:
        raise ValueError("complete must be true")
    cases = doc.get("cases")
    if not isinstance(cases, list):
        raise ValueError("cases must be an array")
    if doc.get("exportedCaseCount") != len(cases):
        raise ValueError("exportedCaseCount must equal len(cases)")
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ValueError(f"cases[{index}] must be an object")
        if case.get("caseStatus") != "CONFIRMED_REAL_CASE":
            raise ValueError(f"cases[{index}] is not CONFIRMED_REAL_CASE")
        if not isinstance(case.get("remarks"), str):
            raise ValueError(f"cases[{index}].remarks must be a string")
    return cases


def extract_feed(doc):
    cases = validate_feed(doc)
    rows = []
    totals = {state: 0 for state in ("CONFIRMED", "PROVISIONAL", "ABSENT", "CONFLICT")}

    for case in cases:
        derived = classify_remarks(case["remarks"])
        state = derived["rootCauseState"]
        if state not in ALLOWED_STATES:
            raise ValueError(f"unexpected rootCauseState: {state}")
        totals[state] += 1
        rows.append({
            "localCaseId": case.get("localCaseId"),
            "sourceTable": case.get("sourceTable"),
            "sourceTicketKey": case.get("sourceTicketKey"),
            "remarks": case["remarks"],
            **derived,
        })

    return {
        "schema": SCHEMA_VERSION,
        "sourceSchema": SOURCE_SCHEMA,
        "sourceGeneratedAt": doc.get("generatedAt"),
        "inputCaseCount": len(cases),
        "totals": totals,
        "cases": rows,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract fail-closed root-cause evidence from Big-circle remarks")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        doc = load_json(args.input)
        report = extract_feed(doc)
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception as exc:
        print(f"ROOT_CAUSE_EXTRACTION_BLOCKED: {exc}", file=sys.stderr)
        return 2

    print(json.dumps({
        "status": "ROOT_CAUSE_EXTRACTION_COMPLETE",
        "inputCaseCount": report["inputCaseCount"],
        "totals": report["totals"],
        "output": str(Path(args.output)),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
