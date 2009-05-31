/**
 * Mozilla Archive Format
 * ======================
 *
 *  Copyright (c) 2005 Christopher Ottley.
 *  Portions Copyright (c) 2008 Paolo Amadini.
 *
 *  This file is part of MAF.
 *
 *  MAF is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  MAF is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with MAF; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

// Provides MAF MHT Handler services

/**
 * The MAF MHT Handler.
 */
function MafMhtHandler() {

}

MafMhtHandler.prototype = {

  extractArchive: function(archivefile, destpath, datasource) {
    var end;

    // MafUtil service - Create destpath
    MafUtils.createDir(destpath);

    try {

      var decoder = new MafMhtDecoderClass();
      var f = Components.classes["@mozilla.org/file/local;1"]
                .createInstance(Components.interfaces.nsILocalFile);
      f.initWithPath(archivefile);
      decoder.initWithFile(f);

    } catch(e) {
      mafdebug(e);
    }

    this.xmafused = false;
    this._addSubjectAndDateMetaData(decoder, datasource);

    var state = new extractContentHandlerStateClass();

    // Only one part in file
    if (decoder.noOfParts() == 1) {
      var contentHandler = new extractContentHandlerClass(destpath, state, datasource, true, this);

      decoder.getContent(contentHandler);
    }

    var multipartDecodeList = new Array();

    var decodedRoot = false;

    // If there is more than one part, we have supporting files.
    if (decoder.noOfParts() > 1) {

      var index_filesDir = MafUtils.appendToDir(destpath, "index_files");

      // Create index_files
      MafUtils.createDir(index_filesDir);

      multipartDecodeList.push(decoder);
    }

    while (multipartDecodeList.length > 0) {
      decoder = multipartDecodeList.pop();

      if (!decodedRoot) {
        // Decode the root
        var rootPartNo = decoder.rootPartNo();
        var rootPart = decoder.getPartNo(rootPartNo);

        // The root is not a multipart part
        if (rootPart.noOfParts() == 1) {
          var contentHandler = new extractContentHandlerClass(destpath, state, datasource, true, this);
          rootPart.getContent(contentHandler);
          decodedRoot = true;
        } else {
          // Multipart
          // Not currently catering for recursion (Multipart inside multipart)
          // TODO: Cater for recursion? Check spec.
          var mRootPartNo = rootPart.rootPartNo();
          var mRootPart = rootPart.getPartNo(mRootPartNo);
          var contentHandler = new extractContentHandlerClass(destpath, state, datasource, true, this);
          mRootPart.getContent(contentHandler);
          decodedRoot = true;

          // Add the rest of the parts from the root to the decode list
          for (var i=0; i<rootPart.noOfParts(); i++) {
            if (i != mRootPartNo) {
              multipartDecodeList.push(rootPart.getPartNo(i));
            }
          }

        }
      } else {
        // No root part number to cater for.
        // If this is not done, then multipart/related decoding may fail.
        rootPartNo = -1;
      }

      // For each other part, decode
      for (var i=0; i<decoder.noOfParts(); i++) {
        if (i != rootPartNo) {
          try  {
            // Decode this part
            var thisPart = decoder.getPartNo(i);
            if (thisPart.noOfParts() > 1) {
              multipartDecodeList.push(thisPart);
            } else {
              var thisContentHandler = new extractContentHandlerClass(index_filesDir, state, datasource, false, this);
              thisPart.getContent(thisContentHandler);
            }
          } catch(e) {

          }
        }
      }
    }

    // Change all the UIDs to local urls
    // Original plan: DOM Parse all the html, get all the tags, check the state, replace if attribute has key value
    //    Issues: DOM Parsing dies due to security exceptions and is not easily synchronous
    // New plan: Use regular expressions
    //              - O(3n*m) algorithm. - Can optimize to make it O(n*m) but harder to manage
    if (!this.xmafused) {
      for (var i=0; i<state.htmlFiles.length; i++) {

        var thisPage = MafUtils.readFile(state.htmlFiles[i]);

        try {
          thisPage = this._makeUrlsAbsolute(thisPage, state.baseUrl[i]);
          thisPage = this._replaceCids(thisPage, state);
          thisPage = this._replaceUrls(thisPage, state);
          MafUtils.deleteFile(state.htmlFiles[i]);
          MafUtils.createFile(state.htmlFiles[i], thisPage);
        } catch(e) {
          mafdebug(e);
        }
      }
    }
  },

  _makeUrlsAbsolute: function(sourceString, baseUrl) {
    var resultString = "";
    var unprocessedString = sourceString;

    if (baseUrl != "") {
      var obj_baseUrl =  Components.classes["@mozilla.org/network/standard-url;1"]
                            .createInstance(Components.interfaces.nsIURL);
      obj_baseUrl.spec = baseUrl;

      var tagre = new RegExp("<[\s]*[a-z]+[^><]*>", "i");
      var urlattribre = new RegExp("(action|background|cite|classid|codebase|data|href|longdesc|profile|src|usemap){1}"
                                  + "[\s]*=[\s]*(('[^'<>]+')|(\"[^\"<>]+\")|([^'\"<>\s]+)){1}", "i");
      var m = tagre.exec(unprocessedString);
      while (m != null) {
        resultString += unprocessedString.substring(0, m.index);
        var tagstr = m.toString();

        // Now we have the tag, find the attribute in it that has a url
        var newTagstr = "";

        var u = urlattribre.exec(tagstr);
        while (u != null) {
          newTagstr += tagstr.substring(0, u.index);
          var urlattribstr = u[0].toString();

          var newUrlattribstr = urlattribstr.substring(0, urlattribstr.indexOf("=") + 1);

          newTagstr += newUrlattribstr;

          var attribstr = Maf_String_trim(urlattribstr.substring(urlattribstr.indexOf("=") + 1, urlattribstr.length));

          var quote = "";
          var unquotedattrib = attribstr;
          // If the attribute is quoted, store the quote and remove it
          if (Maf_String_startsWith(attribstr, "\"") || Maf_String_startsWith(attribstr, "'")) {
            quote = attribstr.substring(0, 1);
            unquotedattrib = attribstr.substring(1, attribstr.length -1);
          }

          unquotedattrib = obj_baseUrl.resolve(unquotedattrib);

          newTagstr += quote + unquotedattrib + quote;

          tagstr = tagstr.substring(u.index + urlattribstr.length, tagstr.length);
          u = urlattribre.exec(tagstr);
        }

        newTagstr += tagstr;

        resultString += newTagstr;

        unprocessedString = unprocessedString.substring(m.index + m.toString().length, unprocessedString.length);
        m = tagre.exec(unprocessedString);
      }


    }

    resultString += unprocessedString;

    return resultString;
  },

  /**
   * Use a regular expression to replace cid URLs with ones from the archive
   */
  _replaceCids: function(sourceString, state) {
    var resultString = "";
    var unprocessedString = sourceString;

    var re = new RegExp("cid:[^>\"']+", "i"); // Absolute URL regular expression

    var m = re.exec(unprocessedString);
    while (m != null) {
      resultString += unprocessedString.substring(0, m.index);
      var originalUrl = m.toString();

      // TODO, decode anything else that might give trouble
      originalUrl = Maf_String_replaceAll(originalUrl, "&amp;", "&");

      // Cater for Hashes
      var baseUrl = originalUrl.split("#")[0];
      var leftOver = originalUrl.split("#")[1];

      baseUrl = "cid:" + baseUrl.substring("cid:".length, baseUrl.length);

      if (state.uidToLocalFilenameMap.hasOwnProperty(baseUrl)) {
        try {
          var newBaseUrlValue = state.uidToLocalFilenameMap[baseUrl];
          resultString += MafUtils.getURIFromFilename(
                                   newBaseUrlValue);
        } catch(e) {
          resultString += baseUrl;
        }
        if (typeof(leftOver) != "undefined") {
          resultString += "#" + leftOver;
        }
      } else {
        resultString += m.toString();
      }

      unprocessedString = unprocessedString.substring(m.index + m.toString().length, unprocessedString.length);
      m = re.exec(unprocessedString);
    }

    resultString += unprocessedString;

    return resultString;
  },

  /**
   * Use a regular expression to replace URLs with ones from the archive
   */
  _replaceUrls: function(sourceString, state) {
    var resultString = "";
    var unprocessedString = sourceString;

      var tagre = new RegExp("<[\s]*[a-z]+[^><]*>", "i");
      var urlattribre = new RegExp("(action|background|cite|classid|codebase|data|href|longdesc|profile|src|usemap){1}"
                                  + "[\s]*=[\s]*(('[^'<>]+')|(\"[^\"<>]+\")|([^'\"<>\s]+)){1}", "i");
      var m = tagre.exec(unprocessedString);
      while (m != null) {
        resultString += unprocessedString.substring(0, m.index);
        var tagstr = m.toString();

        // Now we have the tag, find the attribute in it that has a url
        var newTagstr = "";

        var u = urlattribre.exec(tagstr);
        while (u != null) {
          newTagstr += tagstr.substring(0, u.index);
          var urlattribstr = u[0].toString();

          var newUrlattribstr = urlattribstr.substring(0, urlattribstr.indexOf("=") + 1);

          newTagstr += newUrlattribstr;

          var attribstr = Maf_String_trim(urlattribstr.substring(urlattribstr.indexOf("=") + 1, urlattribstr.length));

          var quote = "";
          var unquotedattrib = attribstr;
          // If the attribute is quoted, store the quote and remove it
          if (Maf_String_startsWith(attribstr, "\"") || Maf_String_startsWith(attribstr, "'")) {
            quote = attribstr.substring(0, 1);
            unquotedattrib = attribstr.substring(1, attribstr.length -1);
          }

          var originalUrl = Maf_String_trim(unquotedattrib);

          // TODO, decode anything else that might give trouble
          originalUrl = Maf_String_replaceAll(originalUrl, "&amp;", "&");

          // Cater for Hashes
          var baseUrl = originalUrl.split("#")[0];
          var leftOver = originalUrl.split("#")[1];

          if (state.uidToLocalFilenameMap.hasOwnProperty(baseUrl)) {
            try {
              var newBaseUrlValue = state.uidToLocalFilenameMap[baseUrl];
              originalUrl = MafUtils.getURIFromFilename(
                                     newBaseUrlValue);
            } catch(e) {
              originalUrl = baseUrl;
            }
            if (typeof(leftOver) != "undefined") {
              originalUrl += "#" + leftOver;
            }
          }

          newTagstr += quote + originalUrl + quote;

          tagstr = tagstr.substring(u.index + urlattribstr.length, tagstr.length);
          u = urlattribre.exec(tagstr);
        }

        newTagstr += tagstr;

        resultString += newTagstr;

        unprocessedString = unprocessedString.substring(m.index + m.toString().length, unprocessedString.length);
        m = tagre.exec(unprocessedString);
      }

    resultString += unprocessedString;

    return resultString;
  },


  _addSubjectAndDateMetaData: function(decoder, datasource) {
    datasource.title = decoder.getHeaderValue("subject") || "Unknown";
    datasource.dateArchived = decoder.getHeaderValue("date") || "Unknown";
    this.xmafused = !!decoder.getHeaderValue("x-maf");
  },

  createArchive: function(archivefile, sourcepath, archivepage, indexFilename, mafeventlistener) {
    try {

      var encoder = new MafMhtEncoderClass(mafeventlistener);

      var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
       createInstance(Ci.nsIScriptableUnicodeConverter);
      converter.charset = "UTF-8";

      // Get hidden window
      var appShell = Components.classes["@mozilla.org/appshell/appShellService;1"]
                        .getService(Components.interfaces.nsIAppShellService);
      var hiddenWnd = appShell.hiddenDOMWindow;

      var navigator = hiddenWnd.navigator;

      encoder.from = "<Saved by " + navigator.appCodeName + " " + navigator.appVersion + ">";
      encoder.subject = converter.ConvertFromUnicode(
       archivepage.title || "Unknown");
      encoder.date = archivepage.dateArchived;

      var indexFile = Components.classes["@mozilla.org/file/local;1"]
                         .createInstance(Components.interfaces.nsILocalFile);
      indexFile.initWithPath(sourcepath);
      indexFile.append(indexFilename);

      var indexFileType = MafUtils.getMIMETypeForURI(MafUtils.getURI(indexFile));

      // Add the index file
      encoder.addFile(indexFile.path, indexFileType,
       converter.ConvertFromUnicode(archivepage.originalUrl), "");

      // Add supporting files
      var supportFilesList = this._getSupportingFilesList(sourcepath);

      for (var i=0; i<supportFilesList.length; i++) {
        var entry = supportFilesList[i];
        encoder.addFile(entry.filepath, entry.type, entry.originalurl, entry.id);
      }

      var f = Components.classes["@mozilla.org/file/local;1"]
                 .createInstance(Components.interfaces.nsILocalFile);
      f.initWithPath(archivefile);
      encoder.encodeTo(f);
    } catch(e) {
      mafdebug(e);
    }
  },


  /**
   * Returns an array of supporting index files
   */
  _getSupportingFilesList: function(sourcepath) {
    var result = new Array();

    var subDirList = new Array();
    subDirList[subDirList.length] = ["index_files"];

    var indexFilesRootURI = "";

    while (subDirList.length > 0) {
      var subDirEntry = subDirList.pop();

      var oDir = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
      oDir.initWithPath(sourcepath);

      if (indexFilesRootURI == "") {
        indexFilesRootURI = MafUtils.getURI(oDir);
      }

      for (var i=0; i<subDirEntry.length; i++) {
        oDir.append(subDirEntry[i]);
      }

      if (oDir.exists() && oDir.isDirectory()) {
        var entries = oDir.directoryEntries;

        while (entries.hasMoreElements()) {
          var currFile = entries.getNext();
          currFile.QueryInterface(Components.interfaces.nsILocalFile);

          if (!currFile.isDirectory()) {
            var resultRec = {};
            resultRec.filepath = currFile.path;
            resultRec.type = MafUtils.getMIMETypeForURI(MafUtils.getURI(currFile));
            resultRec.originalurl = MafUtils.getURI(currFile);
            resultRec.originalurl = resultRec.originalurl.substring(indexFilesRootURI.length, resultRec.originalurl.length);
            resultRec.id = "";

            result.push(resultRec);

          } else {
            var newSubDir = new Array();
            for (var j=0; j<subDirEntry.length; j++) {
              newSubDir[newSubDir.length] = subDirEntry[j];
            }
            newSubDir[newSubDir.length] = currFile.leafName;
            subDirList[subDirList.length] = newSubDir;
          }
        }

      }
    }

    return result;
  }
};


function extractContentHandlerStateClass() {

};

extractContentHandlerStateClass.prototype = {

  uidToLocalFilenameMap: {},

  htmlFiles: new Array(),

  baseUrl: new Array()

};

function extractContentHandlerClass(destpath, state, datasource, isindex, handler) {
  this.destpath = destpath;
  this.handler = handler;
  this.datasource = datasource;
  this.data = "";
  this.isindex = isindex;
  this.state = state;
};

extractContentHandlerClass.prototype = {

  onContentStart: function(contentType, contentId, contentLocation, relativeContentLocation) {
    this.destPathWithFolder = this.destpath;

    var extensionType = "";
    if (this.isindex) {
      if (contentType != "") { // If there's a type use it
        extensionType = MafUtils.getExtensionByType(contentType);
        // If the service has no idea what the extension should be
        if (extensionType == "") {
          // Assume html
          extensionType = ".html";
        }
        this.filename = "index" + extensionType;
      } else { // Otherwise assume it's html
        this.filename = "index.html";
        extensionType = ".html";
      }
      this.datasource.indexLeafName = this.filename;
      this.datasource.originalUrl = contentLocation || "Unknown";
    } else {
      // We need to generate a filename

      // If we have a contentLocation, base it on that
      if (contentLocation != "") {
        var url = Components.classes["@mozilla.org/network/standard-url;1"]
                     .createInstance(Components.interfaces.nsIURL);
        url.spec = contentLocation;

        var relativeIndexFilesUsed = false;

        if (Maf_String_startsWith(relativeContentLocation, "index_files/")) {
          relativeContentLocation = relativeContentLocation.substring("index_files/".length,
                                    relativeContentLocation.length);
          relativeIndexFilesUsed = true;
        }


        var defaultFilename = MafUtils.getDefaultFileName("", url);

        if (relativeIndexFilesUsed) {
          var subFolders = relativeContentLocation;

          var subDir = this.destPathWithFolder;

          while (subFolders.indexOf("/") > -1) {
            var subFolder = subFolders.substring(0, subFolders.indexOf("/"));
            subFolders = subFolders.substring(subFolders.indexOf("/") + 1, subFolders.length);

            subDir = MafUtils.appendToDir(subDir, subFolder);
            MafUtils.createDir(subDir);
          }

          this.destPathWithFolder = subDir;

          defaultFilename = subFolders;
        }

        // If there's no extension, add one based on type
        if (defaultFilename.indexOf(".") == -1) {
          extensionType = MafUtils.getExtensionByType(contentType);
          defaultFilename += extensionType;
        } else {
          extensionType = defaultFilename.substring(defaultFilename.lastIndexOf("."),
                            defaultFilename.length).toLowerCase();
        }

        this.filename = MafUtils.getUniqueFilename(this.destPathWithFolder, defaultFilename);

      } else {
        // Otherwise base it on the content type
        extensionType = MafUtils.getExtensionByType(contentType);
        this.filename = MafUtils.getUniqueFilename(this.destPathWithFolder,
                            "index" + extensionType);
      }
    }

    this.destfile = MafUtils.appendToDir(this.destPathWithFolder, this.filename);

    // In framed pages the content type may be application/octet-stream instead of
    // text/html. To cater for this assume the MIME service is working and has
    // identified the extension to use as either html or htm.
    if ((contentType.toLowerCase().indexOf("text/html") >= 0) ||
        (extensionType.toLowerCase() == ".html") ||
        (extensionType.toLowerCase() == ".htm")) {
      this.state.htmlFiles.push(this.destfile);
      this.state.baseUrl.push(contentLocation);
    }

    if (contentLocation != "") {
      this.state.uidToLocalFilenameMap[contentLocation] = this.destfile;
    }

    if (contentId != "") {
      this.state.uidToLocalFilenameMap["cid:" + contentId] = this.destfile;
    }
  },

  onContent: function(data) { this.data += data; },

  onContentComplete: function() {
    var fileToCreate = this.destfile;
    var contents = this.data;

    try {
      var oFile = Components.classes["@mozilla.org/file/local;1"]
                    .createInstance(Components.interfaces.nsILocalFile);
      oFile.initWithPath(fileToCreate);
      if (!oFile.exists()) {
        oFile.create(0x00, 0644);
      }
    } catch (e) {
      mafdebug(e);
    }

    try {
      var oTransport = Components.classes["@mozilla.org/network/file-output-stream;1"]
                          .createInstance(Components.interfaces.nsIFileOutputStream);
      oTransport.init( oFile, 0x04 | 0x08 | 0x10, 064, 0 );
      oTransport.write(contents, contents.length);
      oTransport.close();
    } catch (e) {
      mafdebug(e);
    }
  }
};
