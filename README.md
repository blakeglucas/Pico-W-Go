# Pico-W-Go Visual Studio Code Extension

Pico-W-Go provides code auto-completion and allows you to communicate with your Raspberry Pi Pico (W) board using the built-in REPL console. Run a single file on your board, sync your entire project or directly type and execute commands.

> __Auto-completion based on Raspberry Pi Pico W MicroPython firmware: [rp2-pico-w-20230407-unstable-v1.19.1-1009-gcfd3b7093.uf2](https://micropython.org/resources/firmware/rp2-pico-w-20230407-unstable-v1.19.1-1009-gcfd3b7093.uf2)__

Works with:
| Platform |    Architectures   |
|----------|:------------------:|
| Windows  | x64, arm64         |
| macOS    | x64, arm64         |
| Linux    | x64, arm64, armvhf |

## Features

- Auto-completion and docs
- Terminal integration for communication with MicroPython REPL on a Pico (w) board
- Running/Transferring files to/from your board
- Built-in virtual-workspace provider for Raspberry Pi Pico (W) boards

![Terminal](images/autocomplete.gif)

## Requirements

* [MicroPython firmware](https://micropython.org/download) flashed onto the Raspberry Pi Pico (W):
    - See [Raspberry Pi docs](https://www.raspberrypi.com/documentation/microcontrollers/micropython.html#drag-and-drop-micropython) for help.

* [Python 3.9 or newer](https://www.python.org/downloads/) installed on your system and in your PATH.
* [`pyserial` pip package](https://pypi.org/project/pyserial/): `pip install pyserial`

Visual Studio Code extensions:
* [ms-python.python](vscode://extension/ms-python.python)
* [visualstudioexptteam.vscodeintellicode](vscode://extension/visualstudioexptteam.vscodeintellicode)
* [ms-python.vscode-pylance](vscode://extension/ms-python.vscode-pylance)

Environment:

On most Linux installations the device file of the Pico serial port is owned by root and a group you normal don't have by default. This leads to timeout and access denied errors when Pico-W-Go tries to connect to the Pico. There are three ways how to solve this problem:
1. Run VS Code in sudo (NOT RECOMMENDED)
2. Normaly adding your user to `dialout` group should fix the issue: `sudo usermod -a -G dialout $THEUSER` (logout required)
3. Dynamically add the group who "owns" the serial port file to your current user. You can easily do this by downloading and executing the `scripts/solvePermissions.sh` script. However you **have** to change the marked line in the script if you Raspberry Pi Pico (w) does not connect to/shows up as `/dev/ttyACM0` to the correct device file. The script will readout the group owning the device file and then add you to this group. (logout required)
```bash
# download scripts/solvePermissions.sh
wget https://raw.githubusercontent.com/paulober/Pico-W-Go/main/scripts/solvePermissions.sh
# maybe not required
chmod +x ./solvePermissions.sh
# (change `/dev/ttyACM0` to the device file/port of your Pico)
# run the script
./solvePermissions.sh
``` 

## Getting started

- First of all open a folder and run `Pico-W-Go > Configure Project` command via `Ctrl+Shift+P` (or the equivalent on your platform) VS Code command palette. This will import stubs for autocompletion and the settings into your project folder. For the auto-completion to work, the extension prompts you (after project configuration) to install recommended extensions mentioned in \#Requirements.

- Have the onboard LED flashing in under 5 minutes:
> Note that [accessing the onboard LED is slightly different for the Pico W compared with the Pico (Page 15 Chapter 3.4)](https://datasheets.raspberrypi.com/picow/connecting-to-the-internet-with-pico-w.pdf). So, you can use the following script in place of `flash.py`:

```python
from machine import Pin
from time import sleep

pin = Pin("LED", Pin.OUT)

while True:
    pin.toggle()
    sleep(1)
```

---

## Extension Settings

This extension contributes the following settings:

* `picowgo.autoConnect`: Ignores any 'device address' setting and automatically connects to the top item in the serialport list.
* `picowgo.manualComDevice`: If autoConnect is set to false Pico-W-Go will automatically connect to the serial port specified here.
* `picowgo.syncFolder`: This folder will be uploaded to the pyboard when using the sync button. Leave empty to sync the complete project. (only allows folders within the project). Use a path relative to the project you opened in vscode, without leading or trailing slash.
* `picowgo.syncAllFileTypes`: If enabled, all files will be uploaded no matter the file type. The list of file types below will be ignored.
* `picowgo.syncFileTypes`: All types of files that will be uploaded to the board, seperated by comma. All other filetypes will be ignored during an upload (or download) action.
* `picowgo.pyIgnore`: Comma separated list of files and folders to ignore when uploading (no wildcard or regular expressions supported).
* `picowgo.openOnStart`: Automatically open the Pico-W-Go console and connect to the board after starting VS Code.
* `picowgo.statusbarButtons`: Select which buttons to show in the statusbar (DO NOT CHANGE, unless you know what you are doing)
* `picowgo.gcBeforeUpload`: [Only works with firmware v1.16.0.b1 and up.] Run garbage collection before uploading files to the board. This will free up some memory usefull when uploading large files but adds about a second or two to the upload process.
* `picowgo.rebootAfterUpload`: Reboots your board after any upload action. Usefull if you are developing with `main.py` or `boot.py`.
* `picowgo.pythonPath`: Path to the Python interpreter. Defaults to null so it will try to auto-detect a suitable python installation.

---

### Note

+ _Most doc-strings for MicroPython functions (descriptions/hints) are from [docs.micropython.org](https://docs.micropython.org/en/v1.19.1/) by © 2014-2023 Damien P. George, Paul Sokolovsky, and contributors._
+ For licensing purposes: Prior to version v3.0.0 of this extension the codebase was a fork of github.com/cpwood/Pico-Go which is a derivative product of Pymakr by Pycom Limited.
