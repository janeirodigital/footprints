const Fs = require('fs');
const Path = require('path');
const Prefixes = require('../shapetree.js/lib/prefixes');
const { DataFactory } = require("n3");
const { namedNode, literal, defaultGraph, quad } = DataFactory;

class ldpProxy {
  constructor (ldpServer, rdfInterface, fetch) {
    // Make sure there's only one filesystem interface for given ldpServer.
    // This will need to be moved to an async function if multiple apps
    // use a filesystem to coordinate access.
    const key = ldpServer;
    if (ldpProxy[key])
      return ldpProxy[key];

    this.ldpServer = ldpServer;
    this.fetch = fetch;
    this._rdfInterface = rdfInterface;
    ldpProxy[key] = this;
    this.promises = {}; // hash[path, list[promises]]
    this._hashCode = `ldpProxy(${JSON.stringify(key)})`; // Math.floor(Math.random()*2**32).toString(16); // identifies this singleton
  }

  hashCode () { return this._hashCode; }

  // Status

  /** exists:boolean - Test if resource exists.
   * @returns: true if resource exists, false if not
   */
  async exists (url) {
    return this.fetch(new URL(url, this.ldpServer)).then(resp => resp.ok, e => false);
  }

  /** rstat:object - Describe existing resource.
   * @returns: {
   *   isContainer - whether the resource is a Container
   * }
   * @throws: resource does not exist
   */
  async rstat (url) {
    const resp = await this.fetch(new URL(url, this.ldpServer));
    const type = resp.ok
          ? parseLinks(resp).type
          : null
    return {
      isContainer: type
        ? type.substr(Prefixes.ns_ldp.length) === 'Container'
        : false
    };
  }

  /** invent:[URL, Store] - create a new ldp:Resource
   * @param parentUrl:URL - URL of parent Container
   * @param requestedName:string - suggested name for created Container
   *   requestedName is expected to include a trailing '/'
   * @param body:string - contents of Resource
   * @param mediaType:string - media type of Resource
   * @returns: [newly-minuted URL, Container graph]
   */
  async invent (parentUrl, requestedName, body, mediaType) {
    const resp = await this.fetch(parentUrl, {
      method: 'POST',
      headers: {
        slug: requestedName,
        link: '<http://www.w3.org/ns/ldp#Resource>; rel="type"',
        'content-type': mediaType
      },
      body
    });
    if (resp.status !== 201) {
      const e = Error(`POST ${requestedName} to ${parentUrl.href} expected 201, got ${resp.status}`);
      try {
        e.body = await resp.text()
      } catch (e) {
        e.body = `response text unavailable: ${e}`
      }
      throw e;
    }
    const url = new URL(resp.headers.get('location'), parentUrl);
    return url;
  }

  /** invent:[URL, Store] - create a new ldp:Resource
   * @param parentUrl:URL - URL of parent Container
   * @param requestedName:string - suggested name for created Container
   *   requestedName is expected to include a trailing '/'
   * @param title:string - suggsted title for created Container
   * @param prefixes:object - where to place prefixes parsed from Container body
   * @returns: [newly-minuted URL, Container graph]
   */
  async inventContainer (parentUrl, requestedName, title, prefixes = {}) {
    console.assert(requestedName.match(/^[^/]+\/$/));
    requestedName = requestedName.substr(0, requestedName.length - 1);
    const reqOpts = {
      method: 'POST',
      headers: {
        slug: requestedName,
        link: '<http://www.w3.org/ns/ldp#Container>; rel="type"',
        'content-type': 'text/turtle'
      },
      body: `
@prefix dcterms: <http://purl.org/dc/terms/>.
@prefix ldp: <http://www.w3.org/ns/ldp#>.

<> a ldp:BasicContainer;
   dcterms:title "${title}".
`
    };
    const postResp = await this.fetch(parentUrl, reqOpts)
    let body;
    if (postResp.status !== 201) {
      const e = Error(`POST ${requestedName} to ${parentUrl.href} expected 201, got ${postResp.status}`);
      try {
        e.body = await resp.text()
      } catch (e) {
        e.body = `response text unavailable: ${e}`
      }
      throw e;
    }
    const location = new URL(postResp.headers.get('location'), parentUrl);
    const getResp = await this.fetch(location);
    body = await getResp.text();
    const graph = await this._rdfInterface.parseTurtle(body, location, prefixes);
    return [location.pathname.substr(parentUrl.pathname.length), graph];
  }


  // R/W/D Resources

  /** read:string - Read contents of resource.
   * @returns: contents
   * @throws: resource does not exist
   */
  async read (url) {
    return this.fetch(new URL(url, this.ldpServer));
  }

  /** write:undefined - Write contents to resource.
   * @param body: contents to be written
   * @throws: resource does not exist
   */
  async write (url, body) {
    return this.fetch(new URL(url, this.ldpServer), {
      method: 'PUT',
      headers: {'content-type': 'text/turtle'},
      body
    });
  }

  /** remove:undefined - Delete resource.
   * @throws: resource does not exist
   */
  async remove (url) {
    return this.fetch(new URL(url, this.ldpServer), {
      method: 'DELETE'
    });
  }

  // R/W/D Containers

  /** readContainer:RDFJS Store - Read body of Container.
   * @returns: body parsed as RDF
   * @param prefixes: where to capures prefixes from parsing
   * @throws:
   *   resource does not exist
   *   parser failures
   */
  async readContainer (url, prefixes) {
    const resp = await this.fetch(new URL(url, this.ldpServer));
    const text = await resp.text();
    return this._rdfInterface.parseTurtle(text, url, prefixes);
  }

  /** writeContainer:undefined - Read body of Container.
   * @param graph: data to be written
   * @param prefixes: prefixes to be used in serialization
   * @throws:
   *   resource does not exist
   *   serializer failures
   */
  async writeContainer (graph, url, prefixes) {
    const body = await this._rdfInterface.serializeTurtle(graph, url, prefixes);
    return await this.fetch(new URL(url, this.ldpServer), {
      method: 'PUT',
      headers: {'content-type': 'text/turtle'},
      body
    });
  }

  /** remove:undefined - Recursively remove a Container.
   * @throws: resource does not exist
   */
  async removeContainer (url) {
    const path = new URL(url, this.ldpServer);
    const graph = await this.readContainer(path, {});
    const children = graph
          .getQuads(namedNode(url), namedNode(Prefixes.ns_ldp + 'contains'), null)
          .map(q => new URL(q.object.value));
    for (const childUrl of children) {
      const rstat = await this.rstat(childUrl);
      await this.remove(childUrl);
    }
    await this.remove(path);
  }


  /** ensureContainer:object - Make Container with invented contents if it doesn't already exist.
   * @param prefixes: prefixes helpful for serialization.
   * @param title: dc:title property to add to invented contents.
   * @returns: [
   *   boolean - whether Container is new (didn't exist),
   *   RDFJS Store - data either read from Container or written to Container
   * ]
   * @throws:
   *   resource does not exist
   *   serializer failures
   */
  async ensureContainer (url, prefixes, title) {
    const _ldpProxy = this;
    const dummy = new URL('.DUMMY', new URL(url, this.ldpServer));
    await this.fetch(dummy, {
      method: 'PUT',
      headers: {'content-type': 'text/turtle'},
      body: '<#I> <shouldNot> "Exist!".'
    });
    await this.remove(dummy);
    return [true, await this.readContainer(url, prefixes)];
  }
}

/* !! redundant against test-suite/servers/LDP.js
 * returns e.g. {"type": "http://...#Container", "rel": "..."}
 */
function parseLinks (resp) {
  const linkHeader = resp.headers.get('link');
  if (!linkHeader) return {};
  const components = linkHeader.split(/<(.*?)> *; *rel *= *"(.*?)" *,? */);
  components.shift(); // remove empty match before pattern captures.
  const ret = {  };
  for (i = 0; i < components.length; i+=3)
    ret[components[i+1]] = components[i];
  return ret
  /* functional equivalent is tedious to maintain:
  return linkHeader.split(/(?:<(.*?)> *; *rel *= *"(.*?)" *,? *)/).filter(s => s).reduce(
    (acc, elt) => {
      if (acc.val) {
        acc.map[elt] = acc.val;
        return {map: acc.map, val: null};
      } else {
        return {map: acc.map, val: elt}
      }
    }, {map:{}, val:null}
  ).map
  */
}

module.exports = ldpProxy;
