// Small Windows launcher. The build embeds the immutable, verified release descriptor.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public class ReleasePart { public string url; public long size; public string sha256; }
public class ReleasePayload { public string filename; public long size; public string sha256; public ReleasePart[] parts; }

public static class Program {
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    static ReleasePayload Payload() {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.json"))
        using (var reader = new StreamReader(stream)) {
            return new JavaScriptSerializer().Deserialize<ReleasePayload>(reader.ReadToEnd());
        }
    }

    static void Download(string destination, Action<int> progress) {
        var payload = Payload();
        if (payload.parts == null || payload.parts.Length == 0 || payload.size <= 0)
            throw new InvalidDataException("Descrição do instalador inválida.");
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        long total = 0;
        bool created = false;
        try {
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var completeHash = SHA256.Create()) {
                created = true;
                var buffer = new byte[65536];
                foreach (var part in payload.parts) {
                    var uri = new Uri(part.url);
                    if (uri.Scheme != "https" || part.size <= 0) throw new InvalidDataException("Endereço inválido.");
                    var request = (HttpWebRequest)WebRequest.Create(uri);
                    request.AllowAutoRedirect = false;
                    request.Timeout = 60000;
                    request.ReadWriteTimeout = 60000;
                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var input = response.GetResponseStream())
                    using (var partHash = SHA256.Create()) {
                        if (response.StatusCode != HttpStatusCode.OK) throw new IOException("Download indisponível.");
                        long received = 0;
                        int count;
                        while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
                            received += count;
                            total += count;
                            if (received > part.size || total > payload.size) throw new InvalidDataException("Tamanho do download inválido.");
                            partHash.TransformBlock(buffer, 0, count, buffer, 0);
                            completeHash.TransformBlock(buffer, 0, count, buffer, 0);
                            output.Write(buffer, 0, count);
                            progress((int)(100 * total / payload.size));
                        }
                        partHash.TransformFinalBlock(new byte[0], 0, 0);
                        if (received != part.size || Hex(partHash.Hash) != part.sha256)
                            throw new InvalidDataException("A verificação do download falhou. Tente novamente.");
                    }
                }
                completeHash.TransformFinalBlock(new byte[0], 0, 0);
                if (total != payload.size || Hex(completeHash.Hash) != payload.sha256)
                    throw new InvalidDataException("A verificação do instalador falhou.");
            }
        } catch {
            if (created && File.Exists(destination)) File.Delete(destination);
            throw;
        }
    }

    [STAThread]
    public static int Main(string[] args) {
        // CI uses the same download/integrity path, then installs and tests this exact file.
        if (args.Length == 2 && args[0] == "--download-to") {
            try { Download(Path.GetFullPath(args[1]), delegate(int value) {}); return 0; }
            catch { return 1; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = new Form { Text = "emekaengCommunicator", ClientSize = new Size(460, 140),
            StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, ControlBox = false };
        var label = new Label { Text = "Baixando os componentes do emekaengCommunicator…", AutoSize = false,
            Location = new Point(20, 20), Size = new Size(420, 40) };
        var bar = new ProgressBar { Location = new Point(20, 75), Size = new Size(420, 25), Maximum = 100 };
        form.Controls.Add(label); form.Controls.Add(bar);
        int exitCode = 0;
        form.Shown += async delegate {
            string directory = Path.Combine(Path.GetTempPath(), "emekaeng-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            string installer = Path.Combine(directory, "emekaengCommunicator-Setup.exe");
            try {
                await Task.Run(delegate {
                    Download(installer, delegate(int value) {
                        form.BeginInvoke((Action)delegate { bar.Value = value; });
                    });
                });
                label.Text = "Download verificado. Abrindo a instalação…";
                form.Hide();
                await Task.Run(delegate {
                    using (var process = Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true })) {
                        process.WaitForExit();
                        exitCode = process.ExitCode;
                    }
                });
            } catch (Exception error) {
                exitCode = 1;
                MessageBox.Show("Não foi possível concluir a instalação. Confira sua conexão e abra o instalador novamente.\n\n" + error.Message,
                    "emekaengCommunicator", MessageBoxButtons.OK, MessageBoxIcon.Error);
            } finally {
                try { Directory.Delete(directory, true); } catch (IOException) {} catch (UnauthorizedAccessException) {}
                form.Close();
            }
        };
        Application.Run(form);
        return exitCode;
    }
}
