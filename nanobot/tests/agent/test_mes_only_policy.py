from nanobot.agent.mes_policy import MES_TOOL_MODULE, mes_only_tool_classes
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.mes import GetLineStatusTool
from nanobot.config.schema import Config


class OtherTool(Tool):
    @property
    def name(self) -> str:
        return "other"

    @property
    def description(self) -> str:
        return "other"

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {}}

    async def execute(self, **kwargs):
        return "ok"


def test_mes_only_config_and_policy_allow_only_mes_module() -> None:
    config = Config(tools={"mesOnly": True, "mes": {"enable": True}})
    assert config.tools.mes_only is True
    assert mes_only_tool_classes([GetLineStatusTool, OtherTool]) == [GetLineStatusTool]


def test_mes_tool_module_marker_is_explicit() -> None:
    assert MES_TOOL_MODULE == "nanobot.agent.tools.mes"
