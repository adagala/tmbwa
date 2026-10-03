type PdfJs = {
  getDocument: (options: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (page: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    }>;
    destroy: () => Promise<void>;
  };
};

// The PDF's text in content order, items separated by spaces: the input
// parseKcbStatement expects. Uploaded files are untrusted, so scripting and
// font loading stay off.
export const extractPdfText = async (bytes: Uint8Array) => {
  // pdfjs-dist ships only as an ES module, which Node 22 loads through the
  // require() this compiles to. Loaded on first use to keep cold starts fast.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const document = await loading.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(content.items.map((item) => item.str ?? '').join(' '));
    }
    return pages.join(' ');
  } finally {
    await loading.destroy();
  }
};
