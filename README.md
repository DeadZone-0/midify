Midify

Midify is a compact application which embeds any file into a regular MIDI music.

Try now

Navigate to https://deadzone-0.github.io/midify/ in your browser.

How it works

When you drag a file onto the encoder window, the program first compresses it, then maps the bytes into musical notes according to the pentatonic scale and produces a MIDI file in the standard Format 0 which can be played in any multimedia player and digital audio workstation.

When you load the MIDI file in the decoder application, the file gets converted back into the original file, and its SHA256 checksum is checked for any changes to the embedded data.

The application also serves as a MIDI player and visualizer. When you drag any regular MIDI file onto it, the file will be played on the Web Audio synthesizers, a piano roll visualization window appears, and the note data can be exported in WAV, JSON and CSV formats.

Running the project

Start a local web server using Python:

python3 server.py 8000

Then navigate to http://127.0.0.1:8000 in your browser.

The whole project runs on the client side in modern browsers without any build process or npm packages.


AI usage - 
not much i have used ai in creating the player cuz...idk how to tbh later i modified some of it i have also used ai in some other stuff too where i cant understand what to do and in creating the svg ( its dumb but yea i wanna try how it comes) ,  too poor to afford a subscription so used web...ahm