import { init, vyget, vycheck } from "@verifyyou-sdk/client";

init({
  publishableKey: "pk_test_3Ka5A2sy218ZJnmenmwo11C3zSr8VrTZFRXhrOcjrS8",
  baseUrl: import.meta.env.VITE_VY_BASE_URL as string | undefined,
});

const { token } = vyget();

if (token) {
  history.replaceState(null, "", "/login");

  const res = await fetch(`/api/vy-confirm?vyt=${encodeURIComponent(token)}`);
  const { verified } = await res.json() as { verified: boolean };

  if (verified) {
    (document.getElementById("vyt-token") as HTMLInputElement).value = token;
    document.getElementById("email-form")?.removeAttribute("hidden");
    document.getElementById("verify-section")?.setAttribute("hidden", "");
  }
} else {
  document.getElementById("verify-button")?.addEventListener("click", () => {
    vycheck();
  });
}
