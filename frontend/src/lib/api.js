// Thin wrapper over the Quereo API ({ success, message, data }).
// Returns `data`, or throws an ApiError carrying the server's message.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const api = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the Quereo server. Is the backend running?", 0);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(json.message || `Request failed (${response.status})`, response.status);
  return json.data;
};

export const get = (path) => api("GET", path);
export const post = (path, body = {}) => api("POST", path, body);
export const patch = (path, body) => api("PATCH", path, body);
export const del = (path, body) => api("DELETE", path, body);
