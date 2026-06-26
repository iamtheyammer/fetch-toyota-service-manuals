import { xml2js } from "xml-js";

export interface ParsedToC {
  [itemOrFolderName: string]: ParsedToC | string;
}

interface ItemElement {
  item?: ItemElement | ItemElement[];
  tocdata?: ToCData;
  name: {
    _text: string;
  };
  _attributes: {
    href: string;
  };
}

export default function parseToC(
  tocXml: string,
  modelYear?: number
): ParsedToC {
  const xmlobj = xml2js(tocXml, {
    compact: true,
    trim: true,
    ignoreDoctype: true,
    ignoreDeclaration: true,
  });

  // @ts-ignore - compact xml parsing doesn't seem to be typed
  const bookTitle: string = xmlobj.xmltoc.name._text;

  // @ts-ignore - see above
  const rawBookItems: ItemElement | ItemElement[] = xmlobj.xmltoc.item;

  // Compact XML parsing yields a bare object (not an array) when <xmltoc> has a
  // single top-level <item> -- as some legacy publications (e.g. the wire-harness
  // manual RM1022Ea) do. Normalise to an array so the iteration below holds for
  // both shapes; getItemPath() already handles the single-vs-array case deeper in
  // the tree.
  const bookItems: ItemElement[] = Array.isArray(rawBookItems)
    ? rawBookItems
    : [rawBookItems];

  const toc: ParsedToC = {};

  bookItems.forEach((item) => {
    const itemPath = getItemPath(item, [], modelYear);

    itemPath.forEach((ip) => {
      // add item to the ToC, final object's value is the path, key is the filename
      const itemDest = recursivelyAccessObject(ip.path, toc);
      // Two sibling leaves can carry an identical display name while pointing at
      // distinct pages (e.g. the 2002 Highlander repair manual has two different
      // "...EGR Flow Excessive Monitor (P0402)" pages in one folder). Keying the
      // ToC purely by name would let the second silently overwrite the first and
      // drop a page, so disambiguate with a numeric suffix when the key is taken.
      let key = ip.filename;
      for (let n = 2; key in itemDest; n++) {
        key = `${ip.filename} (${n})`;
      }
      itemDest[key] = ip.url;
    });
  });

  return toc;
}

interface ToCData {
  _attributes: {
    fromyear: string;
    toyear: string;
  };
}

function tocdataIsApplicable(tocdata: ToCData, year: number): boolean {
  if (!tocdata) {
    return true;
  }

  const fromYear = parseInt(tocdata._attributes.fromyear);
  const toYear = parseInt(tocdata._attributes.toyear);

  return year >= fromYear && year <= toYear;
}

interface ItemPath {
  path: string[];
  filename: string;
  url: string;
}

function getItemPath(
  item: ItemElement,
  currentPath: string[] = [],
  year?: number
): ItemPath[] {
  let subitem = item.item; // needed if year specified

  // VERY CAREFULLY check tocdata and remove pages that don't apply to specified year
  if (year && item.tocdata) {
    // if it's not an array
    if (!Array.isArray(item.tocdata)) {
      // and it's not applicable
      if (!tocdataIsApplicable(item.tocdata, year)) {
        // return
        console.log(
          `Skipping page ${item.name._text} (solo) and its children because it's not applicable to year ${year}.`
        );
        return [];
      }
    } else {
      // it's an array
      // item.tocdata[0] is for item, item.tocdata[1] is for item.item, etc.
      const itemtocdata = item.tocdata[0]; // equivalent of item.tocdata
      const subitemtocdatas = item.tocdata.slice(1); // equivalent of item.item[0].tocdata

      // first, check if the item is applicable
      if (!tocdataIsApplicable(itemtocdata, year)) {
        // if it's not applicable, stop
        console.log(
          `Skipping page ${item.name._text} (array) and its children because it's not applicable to year ${year}.`
        );
        return [];
      }

      // if so, check which children are applicable.
      // but, if subitemtocdatas.length = 1, then we can just check if it's applicable
      if (subitemtocdatas.length === 1) {
        if (!tocdataIsApplicable(subitemtocdatas[0], year)) {
          console.log(
            `Skipping page ${item.name._text} (sub-single) and its children because it's not applicable to year ${year}.`
          );
          return [];
        }
      } else {
        // if there are multiple subitems, we need to check which ones are applicable
        // item.item[0] should coorespond to subitemtocdatas[0], etc.
        subitem = (item.item as ItemElement[]).filter((itm, idx) =>
          tocdataIsApplicable(subitemtocdatas[idx], year)
        );

        const skippedItemCount = subitemtocdatas.length - subitem.length;

        // if there are no applicable subitems, stop
        if (subitem.length === 0) {
          console.log(
            `Skipping page ${item.name._text} (sub-array) and its children because it's not applicable to year ${year}.`
          );
          return [];
        } else if (skippedItemCount > 0) {
          console.log(
            `Skipping ${skippedItemCount} pages below ${item.name._text} because they're not applicable to year ${year}.`
          );
        }
      }
    }
  }

  // if we are on a leaf node
  if (!subitem) {
    return [
      {
        path: currentPath,
        filename: item.name._text,
        url: item._attributes.href,
      },
    ];
  }

  // if not, there may be an array of children...
  if (Array.isArray(subitem)) {
    const items: ItemPath[] = [];
    for (const subItemElement of subitem) {
      items.push(
        ...getItemPath(subItemElement, [...currentPath, item.name._text], year)
      );
    }
    return items;
  }

  // or just one child
  return getItemPath(subitem, [...currentPath, item.name._text], year);
}

function recursivelyAccessObject(
  keys: string[],
  obj: { [any: string]: any }
): { [any: string]: string } {
  const existing = obj[keys[0]];
  if (typeof existing === "string") {
    // A folder shares a name with an earlier sibling leaf (a distinct page that
    // happens to share this folder's title). Descending would overwrite/By the
    // string and throw; instead relocate the leaf under a disambiguated key so
    // it survives, then create the folder in its place.
    let moved = `${keys[0]} (page)`;
    for (let n = 2; moved in obj; n++) {
      moved = `${keys[0]} (page ${n})`;
    }
    obj[moved] = existing;
    obj[keys[0]] = {};
  } else if (!existing) {
    obj[keys[0]] = {};
  }

  if (keys.length <= 1) {
    return obj[keys[0]];
  }

  return recursivelyAccessObject(keys.slice(1), obj[keys[0]]);
}
