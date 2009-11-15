/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Archive Format.
 *
 * The Initial Developer of the Original Code is
 * Paolo Amadini <http://www.amadzone.org/>.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Represents the complete web page contained within an MHTML web archive.
 *
 * This class derives from ArchivePage. See the ArchivePage documentation for
 *  details.
 */
function MhtmlArchivePage(aArchive) {
  ArchivePage.call(this, aArchive);

  // Initialize member variables explicitly for proper inheritance
  this._browserObjectForMetadata = null;
}

MhtmlArchivePage.prototype = {
  // Derive from the ArchivePage class in a Mozilla-specific way. See also
  //  <https://developer.mozilla.org/en/Core_JavaScript_1.5_Guide/Inheritance>
  //  (retrieved 2009-02-01).
  __proto__: ArchivePage.prototype,

  // --- Public methods and properties ---

  /**
   * Stores the page into the archive file asynchronously. When the operation is
   *  completed, the onArchivingComplete method of the provided object is
   *  called, passing the error code as its first argument.
   */
  asyncSave: function(aCallbackObject) {
    // Find the file to original URI mapping made by Save Complete, if present
    var originalUriByPath = aCallbackObject.persistObject &&
     aCallbackObject.persistObject.saveWithContentLocation &&
     aCallbackObject.persistObject.originalUriByPath;
    // Collect the support files associated with this archiving operation
    var archiveBundle = new PersistBundle();
    archiveBundle.scanFolder(this.tempDir, originalUriByPath);
    // Build a standard or MAF-specific MHTML message from the collected files
    var mhtmlMessage = this._buildMessage(archiveBundle, !originalUriByPath);
    // Write the MHTML archive to disk
    this._writeArchive(mhtmlMessage.text);
    // Notify that the archiving operation is completed
    aCallbackObject.onArchivingComplete(0);
  },

  // --- Private methods and properties ---

  /**
   * Returns a MimePart object containing the entire encoded MHMTL message
   *  corresponding to the given resources.
   *
   * @param aPersistBundle   The resources to encode as a MIME message.
   * @param aUseMafVariant   True if the resources have been prepared without
   *                          using MHTML-compatible content locations. If true,
   *                          the "Content-Location" and "Subject" headers will
   *                          be compatible with the Mozilla Archive Format
   *                          extension, but not with other browsers.
   */
  _buildMessage: function(aPersistBundle, aUseMafVariant) {
    // Identify the root resource in the given bundle
    var rootResource = aPersistBundle.resources[0];

    // When saving an archived page, the content location to use may be
    //  different from the one the root resource was currently saved from
    if (this.originalUrl) {
      // Set the new content location. Since this value may have been copied
      //  from the metadata of another page, the resulting content location may
      //  not be a valid absolute or relative URL. As a basic validation, ensure
      //  at least that the new value contains printable ASCII characters only.
      rootResource.contentLocation = this.originalUrl.
       replace(/[^\x20-\x7E]+/g, "_");
    }

    // Create a new MIME message with normal or multipart content type
    var isMultipart = (aPersistBundle.resources.length > 1);
    var mimeMessage = new (isMultipart ? MultipartMimePart : MimePart)();

    // Add the general message headers
    mimeMessage.addRawHeader("From", this._getRawFromHeaderValue());
    if (aUseMafVariant) {
      // Add the custom version of the "Subject" header
      mimeMessage.addRawHeader("Subject",
       this._getRawMafSubjectHeaderValue(this.title || "Unknown"));
    } else {
      // Add the "Subject" header with the proper encoding
      mimeMessage.addUnstructuredHeader("Subject", this.title || "");
    }
    if (this.dateArchived) {
      mimeMessage.addRawHeader("Date", this.dateArchived);
    }
    mimeMessage.addRawHeader("MIME-Version", "1.0");

    // Add the content headers and the actual content
    if (isMultipart) {
      // Add the content headers for the multipart type
      mimeMessage.addRawHeader("Content-Type",
       'multipart/related;\r\n\t' +
       'type="' + rootResource.mimeType + '";\r\n\t' +
       'boundary="' + mimeMessage.boundary + '"');
      // Add the content parts with their own content headers
      for (var [, resource] in Iterator(aPersistBundle.resources)) {
        var childPart = new MimePart();
        this._setMimePartContent(childPart, resource);
        mimeMessage.parts.push(childPart);
      }
    } else {
      // Add the content headers and the content to the message
      this._setMimePartContent(mimeMessage, rootResource);
    }

    // If the MAF variant of the MHTML format is used, the "X-MAF" message
    //  header must be present to inform the recipient that content locations
    //  must be interpreted as relative to the root folder. For compatible MHTML
    //  files, instead, the "X-MAF" header must not be present, and in this case
    //  the "X-MAF-Information" header is added to store the version of MAF used
    //  for saving, that may be needed to help with decoding in the future. This
    //  version of MAF never includes the "X-MAF-Version" header, that indicates
    //  that the content locations conform to the original specification, but
    //  the "Subject" header is encoded on a single line using UTF-8.
    var mafHeaderName = aUseMafVariant ? "X-MAF" : "X-MAF-Information";
    mimeMessage.addRawHeader(mafHeaderName, this._getRawVersionHeaderValue());

    // Return the newly built message
    return mimeMessage;
  },

  /**
   * Returns the encoded string to be used in the "From" header of saved files.
   */
  _getRawFromHeaderValue: function() {
    // Get the source object for the browser's version information
    var nav = Cc["@mozilla.org/appshell/appShellService;1"].
     getService(Ci.nsIAppShellService).hiddenDOMWindow.navigator;
    // Return the version information, assuming it is compatible with the
    //  encoding required for the structured "From" header
    return "<Saved by " + nav.appCodeName + " " + nav.appVersion + ">";
  },

  /**
   * Returns the encoded string to be used in the version header of saved files.
   */
  _getRawVersionHeaderValue: function() {
    // Get the object with the version information of Mozilla Archive Format
    var extUpdateInfo = Cc["@mozilla.org/extensions/manager;1"]
     .getService(Ci.nsIExtensionManager)
     .getItemForID("{7f57cf46-4467-4c2d-adfa-0cba7c507e54}");
    // Return the version information, which contains ASCII characters only
    return "Produced By MAF V" + extUpdateInfo.version;
  },

  /**
   * Returns the string to be used in the "Subject" header when building the
   *  variant of MHTML that is not fully compatible with other browsers.
   */
  _getRawMafSubjectHeaderValue: function(aSubject) {
    // Initialize the UTF-8 converter for the subject line
    var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
     createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    // Build the subject as a single line of characters
    return (converter.ConvertFromUnicode(aSubject) + converter.Finish()).
     replace(/[\r\n]+/g, "");
  },

  /**
   * Adds to the given MIME part the body of the given resource, as well as the
   *  relevant headers describing it. The resource must have a MIME type and a
   *  content location set.
   */
  _setMimePartContent: function(aMimePart, aResource) {
    // Add the content type header first
    aMimePart.addRawHeader("Content-Type", aResource.mimeType);
    // Select the appropriate encoding for the body based on the MIME type
    var encoding = ["text/html", "application/xhtml+xml", "image/svg+xml",
     "text/xml", "application/xml", "text/css", "text/javascript",
     "application/x-javascript"].indexOf(aResource.mimeType) >= 0 ?
     "quoted-printable" : "base64";
    aMimePart.addRawHeader("Content-Transfer-Encoding", encoding);
    // Add the content location header
    aMimePart.addRawHeader("Content-Location", aResource.contentLocation);
    // Set the body of the MIME part, using the selected encoding
    aMimePart.contentTransferEncoding = encoding;
    aMimePart.body = aResource.body;
  },

  /**
   * Saves the given text in the current archive file.
   */
  _writeArchive: function(aContents) {
    // Create and initialize an output stream to write to the archive file
    var outputStream = Cc["@mozilla.org/network/file-output-stream;1"].
     createInstance(Ci.nsIFileOutputStream);
    outputStream.init(this.archive.file, -1, -1, 0);
    try {
      // Write the entire file to disk at once. If the content to be written is
      //  4 GiB or more in size, an exception will be raised.
      outputStream.write(aContents, aContents.length);
    } finally {
      // Close the underlying stream
      outputStream.close();
    }
  }
}