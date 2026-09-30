import base64

import httpx
import pytest

from app.core.config import Settings
from app.imagegen.prompt import landmark_prompt, screen_colour
from app.imagegen.providers import AllImageProvidersFailed, CloudflareImages, HuggingFaceImages, ImageChain, build_image_chain
from app.llm_pipeline.providers import RateLimitError

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20


def test_prompt_has_style_description_and_screen():
    p = landmark_prompt("Taj Mahal", "A white marble mausoleum with a central dome and four minarets.")
    assert "matte painting" in p and "white marble mausoleum" in p and "flat pure green background" in p
    assert screen_colour("a copper statue with green patina") == "magenta"


def test_cloudflare_base64_and_daily_allowance():
    def handler(req):
        if "limited" in req.url.path:
            return httpx.Response(429, text='{"errors":[{"message":"you have used up your daily free allocation of 10,000 neurons"}]}')
        return httpx.Response(200, json={"result": {"image": base64.b64encode(PNG).decode()}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert CloudflareImages("acct", "t", "@cf/m", client).generate("x", 1) == PNG
    with pytest.raises(RateLimitError) as e:
        CloudflareImages("limited", "t", "@cf/m", client).generate("x", 1)
    assert e.value.daily


def test_huggingface_credits_and_loading():
    responses = iter([httpx.Response(503, text="loading"), httpx.Response(200, content=PNG), httpx.Response(402, text="credits")])
    client = httpx.Client(transport=httpx.MockTransport(lambda req: next(responses)))
    hf = HuggingFaceImages("t", "flux", client)
    chain = ImageChain([hf], sleep=lambda s: None)
    assert chain.generate("x", 1) == PNG and chain.last_model == "huggingface:flux"
    with pytest.raises(AllImageProvidersFailed, match="credits"):
        chain.generate("x", 1)


def test_chain_needs_credentials():
    s = Settings(_env_file=None, cloudflare_account_id="", cloudflare_api_token="", hf_token="")
    with pytest.raises(AllImageProvidersFailed, match="CLOUDFLARE_ACCOUNT_ID"):
        build_image_chain(s, client=httpx.Client()).generate("x", 1)
    s2 = Settings(_env_file=None, cloudflare_account_id="a", cloudflare_api_token="b", hf_token="h")
    names = [f"{p.name}:{p.model}" for p in build_image_chain(s2, client=httpx.Client()).providers]
    assert names[0].startswith("cloudflare:") and names[1] == "huggingface:black-forest-labs/FLUX.1-schnell"
