const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const Cors = require('cors');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const RExtra = require('./util/rdf-extra')
const Debug = require('debug')('shapeTrees:LDP');
const LdpConf = JSON.parse(require('fs').readFileSync('./servers.json', 'utf-8')).find(
  conf => conf.name === "LDP"
);
const C = require('./util/constants');
const fileSystem = new (require('./filesystems/fs-promises-utf8'))(LdpConf.documentRoot, LdpConf.indexFile, RExtra)
const ShapeTree = require('./util/shape-tree')(fileSystem)
const Ecosystem = new (require('./ecosystems/simple-apps'))('Apps/', ShapeTree);

let initializePromise;
const ldpServer = express();

main();

async function main () {
  let containerHierarchy =
      {path: '/', title: "DocRoot Container", children: [
        {path: LdpConf.apps + '/', title: "Applications Container"},
        {path: LdpConf.cache + '/', title: "Cache Container"},
        {path: LdpConf.shared + '/', title: "Shared Data Container"},
      ]}
  initializePromise = createContainers(containerHierarchy, new URL('http://localhost/'));

  // Enable pre-flight request for DELETE request.
  const CorsHandler = Cors({
    credentials: true,
    origin: function (origin, callback) {
      // Debug('origin:', origin);
      // if (origin === 'http://localhost')
        callback(null, true)
      // else
      //   callback(new Error('Not allowed by CORS'))
    },
    // async: true,
    // crossDomain: true,
    // url: '...',
    method: 'DELETE',
    // headers: {
    //   'content-type': 'application/x-www-form-urlencoded',
    //   'Authorization': '...'
    // }
  });
  ldpServer.use(function (req, res, next) {
    Debug('cors', req.method, req.originalUrl);
    return CorsHandler(req, res, next);
  })
  ldpServer.use(bodyParser.raw({ type: 'text/turtle', limit: '50mb' }));
  ldpServer.use(bodyParser.raw({ type: 'application/ld+json', limit: '50mb' }));

  ldpServer.use(async function (req, res, next) {
    try {
      Debug('main', req.method, req.originalUrl)
      const rootUrl = new URL(`${req.protocol}://${req.headers.host}/`);
      //TODO: why is originalUrl required below instead of url
      const filePath = req.originalUrl.replace(/^\//, '');
      const lstat = await fileSystem.lstat(new URL(filePath, rootUrl))
            .catch(e => {
              const error = new RExtra.NotFoundError(req.originalUrl, 'queried resource', `${req.method} ${req.originalUrl}`);
              error.status = 404;
              throw error;
            });
      const links = parseLinks(req);
      if (req.method === 'POST') {
        const parent = await new ShapeTree.managedContainer(new URL(req.originalUrl, rootUrl))
              .finish();
        // console.log(parent.url.href, parent.graph.getQuads())

        // otherwise store a new resource or create a new ShapeTree
        const typeLink = links.type.substr(C.ns_ldp.length);
        const toAdd = await firstAvailableFile(rootUrl, filePath, req.headers.slug || typeLink);
        const {host, port} = parseHost(req);
        const isStomp = !!links.shapeTree;
        const isContainer = typeLink === 'Container' || isStomp;
        const newPath = path.join(req.originalUrl.substr(1), toAdd) + (isContainer ? '/' : '');
        const location = `http://${host}:${port}/${newPath}`;
        const shapeTree = isStomp
              ? new ShapeTree.remoteShapeTree(new URL(links.shapeTree), LdpConf.cache)
              : await parent.getRootedShapeTree(LdpConf.cache);

        if (isStomp) {
          // Try to re-use an old ShapeTree.
          const oldLocation = parent.reuseShapeTree(shapeTree);
          const payloadGraph = await RExtra.parseRdf(
            req.body.toString('utf8'),
            new URL(oldLocation || location),
            req.headers['content-type']
          );

          let directory;
          if (oldLocation) {
            // Register the new app and return the location.
            directory = new URL(oldLocation).pathname.substr(1);
          } else {
            await shapeTree.fetch();
            const container = await shapeTree.instantiateStatic(shapeTree.getRdfRoot(), rootUrl,
                                                                newPath, '.', parent);
            parent.indexInstalledShapeTree(location, shapeTree.url);
            await parent.write();
            directory = newPath;
          }
          const appData = ShapeTree.parseInstatiationPayload(payloadGraph)
          const [added, prefixes] = await Ecosystem.registerInstance(appData, shapeTree, directory);
          const rebased = await RExtra.serializeTurtle(added, parent.url, prefixes);

          res.setHeader('Location', oldLocation || location);
          res.status(201); // wanted 304 but it doesn't permit a body
          res.setHeader('Content-type', 'text/turtle');
          res.send(rebased) // respPayload)
        } else {
          // add a resource to a Container

          await shapeTree.fetch();
          const pathWithinShapeTree = shapeTree.path.concat([toAdd]).join('/');
          const step = shapeTree.matchingStep(shapeTree.getRdfRoot(), req.headers.slug);
          let payload = req.body.toString('utf8');
          if (typeLink == 'NonRDFSource') {
            payload = req.body.toString('utf8');
            // what to we validate for non-rdf sources? https://github.com/solid/specification/issues/108
          } else {
            payload = req.body.toString('utf8');
            if (!step.shape)
              // @@issue: is a step allowed to not have a shape?
              throw new RExtra.ShapeTreeStructureError(this.url, `${RExtra.renderRdfTerm(step.node)} has no tree:shape property`);
            await shapeTree.validate(step.shape.value, req.headers['content-type'], payload, new URL(location), new URL(links.root, location).href);
          }
          if (typeLink !== step.type)
            throw new RExtra.ManagedError(`Resource POSTed with link type=${typeLink} while ${step.node.value} expects a ${step.type}`, 422);
          if (typeLink === 'Container') {
            const dir = await shapeTree.instantiateStatic(step.node, rootUrl, newPath, pathWithinShapeTree, parent);
            await dir.merge(payload, new URL(location));
            await dir.write()
          } else {
            // it would be nice to trim the location to allow for conneg
            await fileSystem.write(new URL(path.join(filePath, toAdd), rootUrl), payload, {encoding: 'utf8'})
          }

          parent.addMember(location, shapeTree.url);
          await parent.write();

          res.setHeader('Location', location);
          res.status(201);
          res.send();
        }
      } else if (req.method === 'DELETE') {
        const doomed = new URL(filePath, rootUrl);
        if (doomed.pathname === '/') {
          res.status(405);
          res.send();
        } else {
          const parentUrl = new URL('..', doomed);
          const parent = await new ShapeTree.managedContainer(parentUrl)
                .finish();
          if (lstat.isDirectory())
            await fileSystem.removeContainer(new URL(filePath, rootUrl));
          else
            await fileSystem.remove(new URL(filePath, rootUrl));
          parent.removeMember(doomed.href, null);
          await parent.write();
          res.status(200);
          res.send();
        }
      } else {
        if (lstat.isDirectory()) { // should be isContainer()
          req.url = fileSystem.getIndexFilePath(new URL(req.url, rootUrl));
          res.header('link' , '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"');
          res.header('access-control-expose-headers' , 'link');
        }
        next()
      }
    } catch (e) {
      /* istanbul ignore else */
      if (e instanceof RExtra.ManagedError) {
        /* istanbul ignore if */
        if (e.message.match(/^\[object Object\]$/))
          console.warn('fix up error invocation for:\n', e.stack);
      } else {
        console.warn('miscellaneous exception: ' + (e.stack || e.message))
        e.status = e.status || 500;
      }
      return next(e)
    }    
  });

  //TODO: is this an appropriate use of static?
  ldpServer.use(express.static(LdpConf.documentRoot, {a: 1}));

  // Error handler expects structured error to build a JSON response.
  ldpServer.use(function (err, req, res, next) {
    res.status(err.status)
    res.json({
      message: err.message,
      error: err,
      stack: err.stack
    });
  });
}
// all done

/** recursively create a container and any children containers.
 * @param spec - {path, title, children: [...]}
 * @param path - relative path from parent, e.g. ./ or ./Apps
 * @param title - text for the dc:title property
 * @param children - option list of specs of child containers
 * @param parentUrl - URL of parent container, e.g. URL('http://localhost/')
 */
async function createContainers (spec, parentUrl)  {
  const container = await new ShapeTree.managedContainer(new URL(spec.path, parentUrl), spec.title, null, null).finish();
  spec.container = container; // in case someone needs them later.
  if (spec.children) {
    await Promise.all(spec.children.map(async child => {
      await createContainers(child, container.url);
      container.addMember(new URL(child.path, new URL('http://localhost/')).href, null);
    }));
    await container.write();
  }
}

async function firstAvailableFile (rootUrl, fromPath, slug) {
  let unique = 0;
  let tested;
  while (await fileSystem.exists(
    new URL(path.join(
      fromPath,
      tested = slug + (
        unique > 0
          ? '-' + unique
          : ''
      )
    ), rootUrl)
  ))
    ++unique;
  return tested
}

/*
 * returns e.g. {"type": "http://...#Container", "rel": "..."}
 */
function parseLinks (req) {
  const linkHeader = req.headers.link;
  if (!linkHeader) return {};
  const components = linkHeader.split(/<(.*?)> *; *rel *= *"(.*?)" *,? */);
  components.shift(); // remove empty match before pattern captures.
  // return {type: C.ns_ldp + 'Container'}
  const ret = {  };
  for (i = 0; i < components.length; i+=3)
    ret[components[i+1]] = components[i];
  return ret
  /* functional equivalent is tedious:
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

function parseHost (req) {
  const hostHeader = req.headers.host;
  /* istanbul ignore next */
  const [host, port = 80] = hostHeader.split(/:/);
  return { host, port }
}

module.exports = ldpServer;
module.exports.initializePromise = initializePromise
