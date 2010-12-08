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
 * Portions created by the Initial Developer are Copyright (C) 2008
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

var Ci = Components.interfaces;
var Cc = Components.classes;
var Cr = Components.results;
var Cu = Components.utils;

/**
 * Handles the MAF preferences dialog.
 */
var PrefsDialog = {
  /**
   * Initializes the controls when the dialog is displayed.
   */
  onLoadDialog: function() {
    // Apply brand names to the dialog elements
    Interface.applyBranding(document.getElementById("cbInterfaceMenuApp"));
    Interface.applyBranding(document.getElementById("descAssociateButtons"));
    Interface.applyBranding(document.getElementById("descAssociateUninstall"));
    // Check to see if the application menu is present
    document.getElementById("cbInterfaceMenuApp").hidden =
     !StartupInitializer.hasAppMenu;
    // Checks to see if the "file associations" pane should be active
    if (!this._isOnWindows()) {
      document.getElementById("btnAssociateMAFF").disabled = true;
      document.getElementById("btnAssociateMHTML").disabled = true;
      document.getElementById("descAssociateWindowsOnly").hidden = false;
    }
    // Ensure that the preference values are updated from older versions
    document.getElementById("prefSaveComponent").value = Prefs.saveComponent;
    // Updates the status of the dialog controls
    this.onSaveComponentChange();
    this.onInterfaceMenuPageContextChange();
  },

  /* --- Interactive dialog functions and events --- */

  /**
   * Enables other dialog controls depending on the selected save component.
   */
  onSaveComponentChange: function() {
    var saveComponent = document.getElementById("prefSaveComponent").value;
    document.getElementById("cbSaveMhtmlCompatible").disabled = ["savecomplete",
     "completesave", "exactpersist"].indexOf(saveComponent) < 0;
  },

  /**
   * Enables other dialog controls depending on the page context menu option.
   */
  onInterfaceMenuPageContextChange: function() {
    document.getElementById("cbInterfaceMenuPageContextForTabs").disabled =
     !document.getElementById("prefInterfaceMenuPageContext").value;
  },

  /**
   * Show a file selector allowing the user to select the absolute path of
   *  the temporary folder used by MAF.
   */
  browseForTempFolder: function() {
    // Initialize the file picker component
    var filePicker = Cc["@mozilla.org/filepicker;1"]
      .createInstance(Ci.nsIFilePicker);
    filePicker.init(window, document.title, Ci.nsIFilePicker.modeGetFolder);
    // Find the directory currently displayed in the user interface
    var txtTempFolder = document.getElementById("txtTempFolder");
    // If there is already a directory selected, attempt to use it as the
    //  default in the file picker dialog. If the path is invalid, do nothing.
    if (txtTempFolder.value) {
      try {
        var tempFolderFile = Cc["@mozilla.org/file/local;1"]
         .createInstance(Ci.nsILocalFile);
        tempFolderFile.initWithPath(txtTempFolder.value);
        filePicker.displayDirectory = tempFolderFile;
      } catch (e) { /* Ignore errors */ }
    }
    // If the user made a selection, update the displayed value
    if (filePicker.show() == Ci.nsIFilePicker.returnOK) {
      txtTempFolder.value = filePicker.file.path;
    }
  },

  /**
   * Interactive function. Creates file associations for the MAFF file format.
   */
  createAssociationsForMAFF: function() {
    try {
      FileAssociations.createAssociationsForMAFF();
      // Operation successful
      this._prompts.alert(null, document.title,
       this._str("associate.maff.done.msg"));
    } catch(e) {
      // Operation failed
      Cu.reportError(e);
      this._prompts.alert(null, document.title,
       this._formattedStr("associate.failed.msg", [e.message]));    
    }
  },

  /**
   * Interactive function. Creates file associations for the MHTML file format.
   */
  createAssociationsForMHTML: function() {
    try {
      FileAssociations.createAssociationsForMHTML();
      // Operation successful
      this._prompts.alert(null, document.title,
       this._str("associate.mhtml.done.msg"));
    } catch(e) {
      // Operation failed
      Cu.reportError(e);
      this._prompts.alert(null, document.title,
       this._formattedStr("associate.failed.msg", [e.message]));    
    }
  },

  /* --- Dialog support functions --- */

  _prompts: Cc["@mozilla.org/embedcomp/prompt-service;1"]
   .getService(Ci.nsIPromptService),

  /**
   * Return the string whose key is specified from the dialog's stringbundle.
   */
  _str: function(aKey) {
    return Interface.replaceBrandShortName(document.
     getElementById("bundleDialog").getString(aKey));
  },

  /**
   * Return the string whose key is specified from the dialog's stringbundle,
   *  populating it with the arguments in the given array.
   */
  _formattedStr: function(aKey, aArgs) {
    return document.getElementById("bundleDialog").getFormattedString(aKey,
     aArgs);
  },

  /* --- File association support functions --- */

  /**
   * Returns true if the application is executing on Windows.
   */
  _isOnWindows: function() {
    // For more information, see
    //  <https://developer.mozilla.org/en/nsIXULRuntime> and
    //  <https://developer.mozilla.org/en/OS_TARGET> (retrieved 2008-11-19).
    var xulRuntimeOs = Cc["@mozilla.org/xre/app-info;1"]
     .getService(Ci.nsIXULRuntime).OS;
    return (xulRuntimeOs == "WINNT");
  }
}