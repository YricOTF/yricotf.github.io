let scriptLoad;

function turnstileApi() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptLoad) {
    scriptLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      const timeout = setTimeout(() => fail(), 12_000);
      const fail = () => { clearTimeout(timeout); script.remove(); reject(new Error("真人验证暂时无法加载。")); };
      script.onerror = fail;
      script.onload = () => {
        clearTimeout(timeout);
        if (window.turnstile) resolve(window.turnstile);
        else fail();
      };
      document.head.append(script);
    }).catch(error => { scriptLoad = null; throw error; });
  }
  return scriptLoad;
}

export class HumanCheck {
  constructor(target, onChange) { this.target = target; this.onChange = onChange; }

  async show(sitekey) {
    if (this.active) return;
    this.active = true;
    try {
      this.api = await turnstileApi();
      if (!this.active) return;
      this.widget = this.api.render(this.target, { sitekey, size: "flexible", language: "zh-CN",
        callback: token => this.onChange(token, ""),
        "expired-callback": () => this.onChange("", "验证已过期，请重新验证。"),
        "timeout-callback": () => this.onChange("", "验证已超时，请重试。"),
        "error-callback": () => { this.onChange("", "真人验证遇到问题，请刷新重试。"); return true; },
      });
    } catch (error) {
      this.active = false;
      this.onChange("", error.message);
    }
  }

  reset() { if (this.widget != null) this.api.reset(this.widget); this.onChange("", ""); }

  hide() {
    this.active = false;
    if (this.widget != null) this.api.remove(this.widget);
    this.widget = null;
    this.onChange("", "");
  }
}
