import { xml2js } from "xml-js";

/**
 * ParsedTitle provides all document names (keys) and PDF file names (values).
 * The values go at the end of this URL:
 * https://techinfo.toyota.com/t3Portal/external/en/ewdappu/{manual ID}/ewd/contents/overall/pdf/{value}
 */
export interface ParsedTitle {
  [documentTitle: string]: string;
}

interface TitleElement {
  _attributes: {
    sc: string;
  };
  term: {
    _attributes: {
      from: string;
      to: string;
    };
  };
  name: {
    _attributes: {
      code: string;
    };
    _text: string;
  };
  fig: {
    _attributes: {
      type: string;
    };
    _text: string;
  };
}

export default async function parseTitle(
  titleXml: string
): Promise<ParsedTitle> {
  const xmlobj = xml2js(titleXml, {
    compact: true,
    trim: true,
    ignoreDoctype: true,
    ignoreDeclaration: true,
  });

  // @ts-ignore - xml2js compact doesn't seem to work well with TS
  // this gives us the big list of figures
  const data: TitleElement[] = Object.values(xmlobj.TitleList)[1];

  const parsedTitle: ParsedTitle = {};

  data.forEach((d) => {
    const fileType = d.fig._attributes.type;
    if (fileType !== "pdf" && fileType !== "svgz") {
      console.log(
        `Skipping EWD Page ${d.name._text} because its type is not pdf or svgz, it is ${d.fig._attributes.type}`
      );
      return;
    }

    parsedTitle[
      // include the fig name just in case of duplicate names, which seem common
      `${d.name._text.replace(/\//g, "-")} (${d.fig._text})`
    ] = `${d.fig._text}.${d.fig._attributes.type}`;
  });

  return parsedTitle;
}
