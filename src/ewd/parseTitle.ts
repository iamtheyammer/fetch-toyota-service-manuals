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

  // The figure entries live under the first non-metadata child of <TitleList>
  // (e.g. <System> for system/overall, <Routing> for routing). xml-js prefixes
  // metadata keys with "_" (_attributes, _instruction, _declaration, _doctype).
  // Newer TIS XML adds an <?controldate?> instruction, so we can't rely on a
  // fixed positional index (the old `Object.values(TitleList)[1]` broke on it).
  // The child may be an array (many entries) or a single object (one entry).
  const titleList: any = (xmlobj as any).TitleList || {};
  const entriesKey = Object.keys(titleList).find((k) => !k.startsWith("_"));
  const rawEntries = entriesKey ? titleList[entriesKey] : undefined;
  const data: TitleElement[] = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries
    ? [rawEntries]
    : [];

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
