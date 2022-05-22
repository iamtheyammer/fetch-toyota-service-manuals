import { xml2js } from "xml-js";

export interface ParsedToC {
  [itemOrFolderName: string]: ParsedToC | string;
}

interface ItemElement {
  item?: ItemElement | ItemElement[];
  name: {
    _text: string;
  };
  _attributes: {
    href: string;
  };
}

export default function parseToC(tocXml: string): ParsedToC {
  const xmlobj = xml2js(tocXml, {
    compact: true,
    trim: true,
    ignoreDoctype: true,
    ignoreDeclaration: true,
  });

  // @ts-ignore - compact xml parsing doesn't seem to be typed
  const bookTitle: string = xmlobj.xmltoc.name._text;

  // @ts-ignore - see above
  const bookItems: ItemElement[] = xmlobj.xmltoc.item;

  const toc: ParsedToC = {};

  bookItems.forEach((item) => {
    const itemPath = getItemPath(item, []);

    itemPath.forEach((ip) => {
      // add item to the ToC, final object's value is the path, key is the filename
      const itemDest = recursivelyAccessObject(ip.path, toc);
      itemDest[ip.filename] = ip.url;
    });
  });

  return toc;
}

interface ItemPath {
  path: string[];
  filename: string;
  url: string;
}

function getItemPath(
  item: ItemElement,
  currentPath: string[] = []
): ItemPath[] {
  if (!item.item) {
    return [
      {
        path: currentPath,
        filename: item.name._text,
        url: item._attributes.href,
      },
    ];
  }

  if (Array.isArray(item.item)) {
    const items: ItemPath[] = [];
    for (const subItemElement of item.item) {
      items.push(...getItemPath(subItemElement, [...currentPath, item.name._text]))
    }
    return items;
  }

  // we are on a parent node
  return getItemPath(item.item, [...currentPath, item.name._text]);
}

function recursivelyAccessObject(
  keys: string[],
  obj: { [any: string]: any }
): { [any: string]: string } {
  if (!obj[keys[0]]) {
    obj[keys[0]] = {};
  }

  if (keys.length <= 1) {
    return obj[keys[0]];
  }

  return recursivelyAccessObject(keys.slice(1), obj[keys[0]]);
}
