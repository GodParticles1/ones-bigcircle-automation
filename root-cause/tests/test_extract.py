import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("root_cause_extract", ROOT / "extract.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def state(text):
    return MOD.classify_remarks(text)


def assert_state(text, expected, expected_text=None):
    result = state(text)
    assert result["rootCauseState"] == expected, result
    assert result["rootCauseSource"] == "remarks", result
    if expected_text is not None:
        assert result["rootCauseText"] == expected_text, result
    return result


r = assert_state(
    "现象：服务启动失败；根因：配置文件路径错误；处理：修正路径；结果：恢复。",
    "CONFIRMED",
    "配置文件路径错误",
)
assert "rule=ROOT_LABEL" in r["rootCauseEvidenceSummary"]

assert_state(
    "根因：可能是存储延迟，已安排进一步验证；处理：继续观察。",
    "PROVISIONAL",
    "可能是存储延迟，已安排进一步验证",
)

assert_state(
    "现象：请求超时；当前判断：网络链路抖动；下一步：继续采集证据。",
    "PROVISIONAL",
    "网络链路抖动",
)

assert_state(
    "现象：服务异常；处理：重启服务；结果：恢复。",
    "ABSENT",
    None,
)

conflict = assert_state(
    "根因：配置文件损坏；处理：恢复配置。根因：磁盘只读；结果：待复核。",
    "CONFLICT",
    None,
)
assert "claims=2" in conflict["rootCauseEvidenceSummary"]

# Explicit root-cause labels take precedence over generic 原因 labels.
assert_state(
    "原因：请求量过高；根因：连接池配置错误；处理：调整参数。",
    "CONFIRMED",
    "连接池配置错误",
)

assert_state(
    "最终定位为证书已过期，替换证书后恢复。",
    "CONFIRMED",
    "证书已过期，替换证书后恢复",
)

# Guard against accidental match on 确认是否...
assert_state(
    "处理：确认是否具备远程条件，准备继续排查原因。",
    "ABSENT",
    None,
)

# Strong causal wording with uncertainty must remain provisional.
assert_state(
    "本质是请求过多可能导致队列阻塞。",
    "PROVISIONAL",
    "请求过多可能导致队列阻塞",
)

assert_state(
    "根因：现象与网络切换相关，但受限于证据，无法对宕机根因进行确定性分析。",
    "PROVISIONAL",
)

assert_state(
    "最终定位为网络设备故障，但高负载现象还没解释。",
    "PROVISIONAL",
    "网络设备故障，但高负载现象还没解释",
)

remarks = "现象：A\n根因：B；处理：C。"
feed = {
    "schema": "bigcircle.confirmed-case-export/v1alpha1",
    "generatedAt": "2026-01-01T00:00:00Z",
    "complete": True,
    "exportedCaseCount": 1,
    "cases": [{
        "localCaseId": "CASE-1",
        "sourceTable": "WEEK-1",
        "sourceTicketKey": "ABC-1",
        "caseStatus": "CONFIRMED_REAL_CASE",
        "remarks": remarks,
    }],
}
report = MOD.extract_feed(feed)
assert report["cases"][0]["remarks"] == remarks
assert report["cases"][0]["rootCauseText"] == "B"
assert report["totals"]["CONFIRMED"] == 1

bad = json.loads(json.dumps(feed))
bad["cases"][0]["caseStatus"] = "INCOMPLETE"
try:
    MOD.extract_feed(bad)
    raise AssertionError("expected non-confirmed feed row to be rejected")
except ValueError:
    pass

print("ROOT_CAUSE_EXTRACTION_TEST_PASS")
