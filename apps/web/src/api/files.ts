import api, { errorMessage } from './api';

/** Downloads a file the API serves (signed in), saving it under the server's file name. */
export const download = async (url: string, fallbackName: string): Promise<void> => {
  let res;
  try {
    res = await api.get(url, { responseType: 'blob', transformResponse: [(d: unknown) => d] });
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
  const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
};
