// HARMLESS TEST FIXTURE: decodes "echo hello" from base64 and prints it. Nothing is executed.
const text = Buffer.from("ZWNobyBoZWxsbw==", "base64").toString();
console.log(text);
