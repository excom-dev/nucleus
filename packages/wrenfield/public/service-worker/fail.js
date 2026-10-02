// Ends a request with an error the API answers as JSON: `{ message, field }` at `status`.
export const fail = (status, message, field) => {
  throw Object.assign(new Error(message), { status, field });
};
