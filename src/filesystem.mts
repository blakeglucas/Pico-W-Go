import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileChangeType,
  FilePermission,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  Uri,
} from "vscode";
import { PyboardRunner, PyOutType } from "@paulober/pyboard-serial-com";
import type {
  PyOutGetItemStat,
  PyOutListContents,
  PyOutStatus,
} from "@paulober/pyboard-serial-com";
import Logger from "./logger.mjs";
import { v4 as uuidv4 } from "uuid";
import { basename, dirname, join } from "path";
import { tmpdir } from "os";
import { mkdir, readFile, rmdir, unlink, writeFile } from "fs/promises";
import { randomBytes } from "crypto";
import remoteConfigFs from "./remoteConfig.mjs";
import { getTypeshedPicoWStubPath } from "./api.mjs";

// TODO: maybe use startsWidth instead of includes to avoid false positives in child folders
const forbiddenFolders = [".vscode", ".git"];

// disabled because the Python and Pylance extensions don't currently support virtual workspaces
const picoWFsVscodeConfiguration = false;

export class PicoWFs implements FileSystemProvider {
  private logger: Logger;

  private cache: Map<string, any> = new Map();
  private remoteConfigFs = remoteConfigFs;

  private pyb: PyboardRunner;
  private cacheEnabled: boolean = false;

  // FileSystemProvider stuff
  private _emitter = new EventEmitter<FileChangeEvent[]>();
  public onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

  constructor(pyboardRunner: PyboardRunner) {
    this.logger = new Logger("PicoWFs");
    this.pyb = pyboardRunner;

    if (picoWFsVscodeConfiguration) {
      getTypeshedPicoWStubPath().then(path => {
        if (path === null) {
          return;
        }

        this.remoteConfigFs[".vscode"].children["settings.json"].setContent(
          path[1],
          path[0]
        );
      });
    }
  }

  public fileChanged(type: FileChangeType, uri: Uri): void {
    this._emitter.fire([{ type, uri }]);
  }

  public watch(
    uri: Uri,
    options: {
      readonly recursive: boolean;
      readonly excludes: readonly string[];
    }
  ): Disposable {
    return new Disposable(() => {});
  }

  public async stat(uri: Uri): Promise<FileStat> {
    if (forbiddenFolders.some(folder => uri.path.includes(folder))) {
      if (picoWFsVscodeConfiguration && uri.path.includes("/.vscode")) {
        switch (basename(uri.path)) {
          case "settings.json":
            return {
              type: FileType.File,
              ctime:
                this.remoteConfigFs[".vscode"].children["settings.json"]
                  .created,
              mtime:
                this.remoteConfigFs[".vscode"].children["settings.json"]
                  .modified,
              size: this.remoteConfigFs[".vscode"].children["settings.json"]
                .size,
              permissions: FilePermission.Readonly,
            };
          case ".vscode":
            return {
              type: FileType.Directory,
              ctime: this.remoteConfigFs[".vscode"].created,
              mtime: this.remoteConfigFs[".vscode"].modified,
              size: this.remoteConfigFs[".vscode"].size,
              permissions: FilePermission.Readonly,
            };
          default:
            break;
        }
      }

      this.logger.debug("stat: (inside) forbidden folder: " + uri.path);
      throw FileSystemError.FileNotFound(uri);
    }

    const result = await this.pyb.getItemStat(uri.path);

    if (result.type !== PyOutType.getItemStat) {
      this.logger.error("stat: unexpected result type");
      throw FileSystemError.Unavailable(uri);
    }

    const itemStat = (result as PyOutGetItemStat).stat;

    if (
      itemStat === null ||
      itemStat.created === undefined ||
      itemStat.lastModified === undefined
    ) {
      this.logger.warn("stat: item not found: " + uri.path);
      throw FileSystemError.FileNotFound(uri);
    }

    return {
      type: itemStat.isDir ? FileType.Directory : FileType.File,
      ctime: itemStat.created.getTime(),
      mtime: itemStat.lastModified.getTime(),
      size: itemStat.size,
    };
  }

  public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    if (forbiddenFolders.some(folder => uri.path.includes(folder))) {
      if (picoWFsVscodeConfiguration && basename(uri.path) === ".vscode") {
        return Object.keys(this.remoteConfigFs[".vscode"].children).map(
          file => [file, FileType.File]
        );
      }

      this.logger.debug("readDirectory: forbidden folder: " + uri.path);
      throw FileSystemError.FileNotFound(uri);
    }

    const result = await this.pyb.listContents(uri.path);

    if (result.type === PyOutType.none) {
      this.logger.error("readDirectory: Directory propably not found");
      throw FileSystemError.FileNotFound(uri);
    } else if (result.type !== PyOutType.listContents) {
      this.logger.error("readDirectory: unexpected result type");
      throw FileSystemError.Unavailable(uri);
    }

    const items = (result as PyOutListContents).response;

    const children: [string, FileType][] = items.map(item => [
      item.path,
      item.isDir ? FileType.Directory : FileType.File,
    ]);
    if (picoWFsVscodeConfiguration && uri.path === "/") {
      children.push([".vscode", FileType.Directory]);
    }
    return children;
  }

  public async createDirectory(uri: Uri): Promise<void> {
    if (forbiddenFolders.includes(basename(uri.path))) {
      this.logger.debug("createDirectory: forbidden folder");
      throw FileSystemError.NoPermissions(uri);
    }

    const result = await this.pyb.createFolders([uri.path]);
    if (result.type === PyOutType.status) {
      const status = (result as PyOutStatus).status;
      if (!status) {
        this.logger.warn("createDirectory: propably already existsed");
        throw FileSystemError.FileExists(uri);
      }
      return;
    }

    this.logger.error("createDirectory: unexpected result type");
    throw FileSystemError.Unavailable(uri);
  }

  public async readFile(uri: Uri): Promise<Uint8Array> {
    if (forbiddenFolders.some(folder => uri.path.includes(folder))) {
      if (
        uri.path.includes("/.vscode") &&
        basename(uri.path) === "settings.json"
      ) {
        return this.remoteConfigFs[".vscode"].children["settings.json"].content;
      }

      this.logger.debug("readFile: file in forbidden folder");
      throw FileSystemError.FileNotFound(uri);
    }

    // create path to temporary file
    const tmpFilePath = join(tmpdir(), uuidv4({ random: _v4Bytes() }) + ".tmp");
    const result = await this.pyb.downloadFiles([uri.path], tmpFilePath);

    if (result.type === PyOutType.status) {
      const status = (result as PyOutStatus).status;
      if (!status) {
        this.logger.error("readFile: File not found");
        throw FileSystemError.FileNotFound(uri);
      } else {
        const content: Uint8Array = new Uint8Array(await readFile(tmpFilePath));
        // delete tmpFilePath
        await unlink(tmpFilePath);

        return content;
      }
    }

    this.logger.error("readFile: unexpected result type");
    throw FileSystemError.FileNotFound(uri);
  }

  public async writeFile(
    uri: Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
    if (forbiddenFolders.some(folder => uri.path.includes(folder))) {
      this.logger.error("writeFile: file destination in forbidden folder");
      throw FileSystemError.NoPermissions(uri);
    }

    const tempDir = join(tmpdir(), uuidv4({ random: _v4Bytes() }));
    await mkdir(tempDir);

    const tmpFilePath = join(tempDir, basename(uri.path));
    // write
    await writeFile(tmpFilePath, content);

    // upload
    const result = await this.pyb.uploadFiles(
      [tmpFilePath],
      // trailing slash needed so uploader knows what is a destination FOLDER
      dirname(uri.path) + "/"
    );
    if (result.type === PyOutType.status) {
      const status = (result as PyOutStatus).status;
      if (!status) {
        this.logger.warn("writeFile: failed to upload file");
        throw FileSystemError.FileExists(uri);
      }
    }

    // clean-up temp
    await unlink(tmpFilePath);
    await rmdir(tempDir);
  }

  public async delete(
    uri: Uri,
    options: { readonly recursive: boolean }
  ): Promise<void> {
    if (forbiddenFolders.some(folder => uri.path.includes(folder))) {
      this.logger.error("delete: file destination in forbidden folder");
      throw FileSystemError.NoPermissions(uri);
    }

    if (options.recursive) {
      const result = await this.pyb.deleteFileOrFolder(
        uri.path,
        options.recursive
      );
      if (result.type === PyOutType.status) {
        const status = (result as PyOutStatus).status;
        if (!status) {
          throw FileSystemError.FileNotFound(uri);
        }
      }
    } else {
      let result = await this.pyb.deleteFileOrFolder(
        uri.path,
        options.recursive
      );
      if (result.type === PyOutType.status) {
        let status = (result as PyOutStatus).status;
        if (!status) {
          // both failed, so most likely the fs item does not exist
          throw FileSystemError.FileNotFound(uri);
        }
      }
    }
  }

  public async rename(
    oldUri: Uri,
    newUri: Uri,
    // does always overwrite
    options: { readonly overwrite: boolean }
  ): Promise<void> {
    if (forbiddenFolders.some(folder => oldUri.path.includes(folder))) {
      this.logger.error("rename: file destination in forbidden folder");
      throw FileSystemError.NoPermissions(oldUri);
    }

    const result = await this.pyb.renameItem(oldUri.path, newUri.path);

    if (result.type === PyOutType.status) {
      const status = (result as PyOutStatus).status;
      if (!status) {
        throw FileSystemError.FileExists(newUri);
      }
    }

    this.logger.error("rename: unexpected result type");
    throw FileSystemError.Unavailable(oldUri);
  }

  // TODO: implement
  public async copy?(
    source: Uri,
    destination: Uri,
    options: { readonly overwrite: boolean }
  ): Promise<void> {}
}

/**
 * Generate random bytes for uuidv4 as crypto.getRandomValues is not supported in vscode extensions
 *
 * @returns 16 random bytes
 */
function _v4Bytes(): Uint8Array {
  return new Uint8Array(randomBytes(16).buffer);
}
