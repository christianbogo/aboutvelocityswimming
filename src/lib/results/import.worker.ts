import { parseMeetFiles } from "./parse-file";
self.onmessage = async (
  event: MessageEvent<Array<{ name: string; bytes: Uint8Array }>>,
) => {
  try {
    self.postMessage({ result: await parseMeetFiles(event.data) });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Unable to read these result files.",
    });
  }
};
