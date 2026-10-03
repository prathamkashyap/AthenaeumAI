const configuredApiRoot = import.meta.env.VITE_API_ROOT || import.meta.env.VITE_API_URL;

/**
 * Local development keeps working with no configuration at all: `npm run dev`
 * serves the app on :8080/8081 and the API on :5001.
 *
 * A production build must not inherit that. If `VITE_API_ROOT` is unset the
 * bundle would silently address localhost, and every request would fail with a
 * network error that looks like a broken deployment rather than a missing build
 * variable. So the production build refuses to boot instead, naming the variable
 * that has to be set.
 */
export const API_ROOT = configuredApiRoot ?? "http://localhost:5001/api/v1";

if (import.meta.env.PROD && !configuredApiRoot) {
  throw new Error(
    "VITE_API_ROOT is not set. A production build must address the deployed API, " +
      "for example https://api.athenaeumai.tech/api/v1",
  );
}

export const authHeaders = () => {
  const token = localStorage.getItem("athenaeum_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const apiFetch = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  const isFormData = init.body instanceof FormData;

  if (!isFormData && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  Object.entries(authHeaders()).forEach(([key, value]) => headers.set(key, value));

  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem("athenaeum_token");
    localStorage.removeItem("athenaeum_user");
    window.dispatchEvent(new Event("athenaeum-auth-expired"));
  }

  return response;
};
