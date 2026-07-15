export const API_ROOT =
  import.meta.env.VITE_API_ROOT ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001/api/v1";

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
